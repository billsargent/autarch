import { db } from "@/db";
import { jobs, workSessions, conversations } from "@/db/schema";
import { eq, and, gte, lte, ne, inArray, asc, desc, count } from "drizzle-orm";
import { getSettings, type AgentSettingsRow } from "@/lib/agent/settingsStore";
import { BudgetError, TurnBusyError, runAgentTurn, type SessionTrigger } from "@/lib/agent/runner";
import { nextCronRun } from "@/lib/agent/cron";
import { reapStaleSessions } from "@/lib/agent/sessions";
import { requestCancel } from "@/lib/agent/turnLock";
import { ensureMayor } from "@/lib/agent/agents";
import { agents } from "@/db/schema";

// Standalone background scheduler for the agent. Run with: npm run worker
// Polls the DB for due jobs, respects the human's global pause switch and
// frequency/duration limits, and hands each job off to runAgentTurn.

const POLL_MS = 15_000;
const DAILY_REPORT_HOUR = 9;
const SELF_WORK_INTERVAL_MINUTES = 90;
const SELF_WORK_MAX_MINUTES = 10;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextRun(intervalMinutes: number): Date {
  return new Date(Date.now() + intervalMinutes * 60_000);
}

// The daily self-report always points at the next 09:00 local, never "now + 24h",
// so it doesn't drift with run duration.
function nextDailyReport(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, DAILY_REPORT_HOUR, 0, 0);
}

function nextRunFor(job: typeof jobs.$inferSelect): Date {
  if (job.kind === "daily_report") return nextDailyReport();
  if (job.cron) {
    const next = nextCronRun(job.cron, new Date());
    if (next) return next;
  }
  return nextRun(job.intervalMinutes);
}

// Seed the built-in daily self-report job once (next run at 09:00 tomorrow).
// Switched off: nothing autonomous runs until the owner turns it on (#52).
async function ensureDailyReportJob() {
  const existing = await db.select().from(jobs).where(eq(jobs.kind, "daily_report")).limit(1);
  if (existing.length) return;
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, DAILY_REPORT_HOUR, 0, 0);
  await db.insert(jobs).values({
    agentId: (await ensureMayor()).id,
    name: "Daily self-report",
    instruction:
      "Write a concise daily self-report: what you did over the past day, what you spent, what you learned, and your plan for today. Save it to your journal (category=reflection).",
    kind: "daily_report",
    intervalMinutes: 1440,
    maxDurationMinutes: 10,
    enabled: false,
    nextRunAt: first,
  });
  console.log("[worker] added the daily self-report job, switched off (turn it on in the Mayor's ledger → Free time)");
}

// Seed a recurring self-directed work window, so the agent can take initiative
// through the day. Switched off until the owner opts in (#52); when on, it
// respects the cooldown and daily cap.
async function ensureSelfWorkJob() {
  const existing = await db.select().from(jobs).where(eq(jobs.kind, "self_work")).limit(1);
  if (existing.length) return;
  await db.insert(jobs).values({
    agentId: (await ensureMayor()).id,
    name: "Self-directed work",
    instruction:
      "Your own initiative window. Review your goals and journal, pick the highest-value goal, and make concrete progress on it: explore, build, test, or automate something real. Take action — don't just plan. Journal what you did. Only notify the human if something genuinely needs their input.",
    kind: "self_work",
    intervalMinutes: SELF_WORK_INTERVAL_MINUTES,
    maxDurationMinutes: SELF_WORK_MAX_MINUTES,
    enabled: false,
    nextRunAt: new Date(Date.now() + SELF_WORK_INTERVAL_MINUTES * 60_000),
  });
  console.log(`[worker] added the self-directed work job, switched off (turn it on in the Mayor's ledger → Free time)`);
}

// Enforce "how often it starts working" (cooldown + daily cap). Applies to
// autonomous (scheduled/report) sessions only, not human-initiated chat.
async function checkWorkAllowed(settings: AgentSettingsRow): Promise<{ allowed: boolean; reason?: string }> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayRows = await db
    .select({ n: count() })
    .from(workSessions)
    .where(
      and(
        gte(workSessions.startedAt, todayStart),
        inArray(workSessions.trigger, ["scheduled", "report"]),
        ne(workSessions.status, "skipped"),
      ),
    );
  const todayCount = Number(todayRows[0]?.n ?? 0);
  if (todayCount >= settings.maxSessionsPerDay) {
    return { allowed: false, reason: `daily cap reached (${todayCount}/${settings.maxSessionsPerDay} sessions today)` };
  }

  const lastScheduled = await db
    .select()
    .from(workSessions)
    .where(and(inArray(workSessions.trigger, ["scheduled", "report"]), ne(workSessions.status, "skipped")))
    .orderBy(desc(workSessions.startedAt))
    .limit(1);
  if (lastScheduled.length) {
    const elapsedMin = (Date.now() - lastScheduled[0].startedAt.getTime()) / 60_000;
    if (elapsedMin < settings.minGapMinutes) {
      return {
        allowed: false,
        reason: `cooldown active (${Math.round(elapsedMin)}m since last session; need ${settings.minGapMinutes}m)`,
      };
    }
  }
  return { allowed: true };
}

async function ensureJobConversation(job: typeof jobs.$inferSelect): Promise<number> {
  if (job.conversationId) return job.conversationId;
  const title = job.reportSessionTitle || `Job: ${job.name}`;
  const inserted = await db
    .insert(conversations)
    .values({ title, agentId: job.agentId })
    .returning();
  await db
    .update(jobs)
    .set({ conversationId: inserted[0].id, updatedAt: new Date() })
    .where(eq(jobs.id, job.id));
  return inserted[0].id;
}

// Shutdown (#28): on SIGTERM/SIGINT stop taking new work, ask the running
// turn to stop (it finishes its session as "terminated" within a second or
// so), then exit. If it doesn't stop in time, exit anyway; the turn lock
// releases the session when its heartbeat goes quiet.
let stopping = false;
let currentConversation: number | null = null;
let idle: (() => void) | null = null;
const SHUTDOWN_GRACE_MS = 30_000;

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal}: stopping${currentConversation ? " the current turn" : ""}…`);
  if (currentConversation) requestCancel(currentConversation);
  idle?.();
  setTimeout(() => {
    console.log("[worker] the turn didn't stop in time; exiting anyway");
    process.exit(0);
  }, SHUTDOWN_GRACE_MS).unref();
}

async function runDueJobs() {
  if (stopping) return;
  const settings = await getSettings();
  if (settings.paused) return; // global kill switch: don't start anything

  // Jobs of villagers who are resting (paused) or have left wait.
  const working = new Set(
    (await db.select({ id: agents.id }).from(agents).where(eq(agents.status, "active"))).map((a) => a.id),
  );
  const due = (
    await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.enabled, true), lte(jobs.nextRunAt, new Date())))
      .orderBy(asc(jobs.nextRunAt))
      .limit(10)
  )
    .filter((j) => j.agentId === null || working.has(j.agentId))
    .slice(0, 5);
  if (!due.length) return;

  // Overlap guard: never start a scheduled session while any turn is active.
  const running = await db.select().from(workSessions).where(eq(workSessions.status, "running")).limit(1);
  if (running.length) return;

  for (let i = 0; i < due.length; i++) {
    const job = due[i];

    // Enforce cooldown + daily cap per job (not just once per tick) so several
    // jobs due at the same time can't blow past maxSessionsPerDay / minGapMinutes.
    const latestSettings = await getSettings();
    if (latestSettings.paused || stopping) break;
    const { allowed, reason } = await checkWorkAllowed(latestSettings);
    if (!allowed) {
      for (const j of due.slice(i)) {
        await db
          .update(jobs)
          .set({ lastStatus: "skipped", lastError: reason, nextRunAt: nextRunFor(j), updatedAt: new Date() })
          .where(eq(jobs.id, j.id));
      }
      console.log(`[worker] ${due.length - i} due job(s) skipped: ${reason}`);
      return;
    }

    // Overlap guard: never run two sessions at once.
    const busy = await db.select().from(workSessions).where(eq(workSessions.status, "running")).limit(1);
    if (busy.length) break;

    const isReport = job.kind === "daily_report";
    const isSelfWork = job.kind === "self_work";
    const trigger: SessionTrigger = isReport ? "report" : "scheduled";
    const eventNote = isReport
      ? `[DAILY REPORT] It's time for your daily self-report. Look back at what you did over the past day (journal, sessions, tool executions), summarize it, note what you spent, and write your plan for today into your journal (category=reflection).`
      : isSelfWork
        ? `[SELF-DIRECTED WORK] Your initiative window is open (up to ${job.maxDurationMinutes} minutes). Review your goals and journal, pick the highest-value goal, and take real action on it — explore, build, test, or automate something. Act, don't plan. Journal what you did. Only notify the human if something genuinely needs their input.`
        : `[SCHEDULED WORK] Your scheduled job "${job.name}" is due — a work window just opened (up to ${job.maxDurationMinutes} minutes). ${job.instruction ? `Job instructions: ${job.instruction}` : "Decide what to do and get to work."}`;

    await db
      .update(jobs)
      .set({ lastRunAt: new Date(), lastStatus: "running", lastError: null, updatedAt: new Date() })
      .where(eq(jobs.id, job.id));

    let ran = true;
    try {
      const conversationId = await ensureJobConversation(job);
      currentConversation = conversationId;
      await runAgentTurn({
        conversationId,
        eventNote,
        trigger,
        jobId: job.id,
        maxDurationMinutes: job.maxDurationMinutes,
      });
      await db
        .update(jobs)
        .set({ lastStatus: "completed", updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
      console.log(`[worker] job #${job.id} "${job.name}" completed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof TurnBusyError) {
        // Someone is talking in the job's conversation: nothing ran. Leave the
        // job due so it runs on a later tick (#18).
        ran = false;
        await db
          .update(jobs)
          .set({ lastStatus: "waiting", lastError: "Its conversation was busy; it will run when it's free.", updatedAt: new Date() })
          .where(eq(jobs.id, job.id));
        console.log(`[worker] job #${job.id} "${job.name}" waiting: its conversation is busy`);
      } else if (err instanceof BudgetError) {
        // Over budget: skip this run; it comes round again at its next time.
        await db.update(jobs).set({ lastStatus: "skipped", lastError: msg, updatedAt: new Date() }).where(eq(jobs.id, job.id));
        console.log(`[worker] job #${job.id} "${job.name}" skipped: ${msg}`);
      } else {
        await db
          .update(jobs)
          .set({ lastStatus: "failed", lastError: msg, updatedAt: new Date() })
          .where(eq(jobs.id, job.id));
        console.error(`[worker] job #${job.id} "${job.name}" failed: ${msg}`);
      }
    } finally {
      currentConversation = null;
      if (ran) {
        await db
          .update(jobs)
          .set({ nextRunAt: nextRunFor(job), updatedAt: new Date() })
          .where(eq(jobs.id, job.id));
      }
    }
    if (!ran) break;
  }
}

async function main() {
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  console.log("[worker] Autarch scheduler started (poll every " + POLL_MS / 1000 + "s).");
  try {
    await ensureDailyReportJob();
  } catch (err) {
    console.error("[worker] could not seed daily report job:", err);
  }
  try {
    await ensureSelfWorkJob();
  } catch (err) {
    console.error("[worker] could not seed self-directed work job:", err);
  }
  while (!stopping) {
    try {
      // Clean up sessions left "running" by a crash, or nothing would ever run again.
      const reaped = await reapStaleSessions();
      if (reaped) console.log(`[worker] cleaned up ${reaped} interrupted session(s)`);
      await runDueJobs();
    } catch (err) {
      console.error("[worker] tick error:", err);
    }
    if (stopping) break;
    // Sleep until the next poll, or until a shutdown wakes us.
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, POLL_MS);
      idle = () => {
        clearTimeout(t);
        resolve();
      };
    });
    idle = null;
  }
  console.log("[worker] stopped.");
  process.exit(0);
}

main();
