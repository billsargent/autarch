import { NextResponse } from "next/server";
import { db } from "@/db";
import { workSessions, jobs, conversations } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { runAgentTurn } from "@/lib/agent/runner";
import { getSettings } from "@/lib/agent/settingsStore";
import { TurnBusyError, isConversationBusy } from "@/lib/agent/turnLock";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = await db
    .select()
    .from(workSessions)
    .where(eq(workSessions.jobId, Number(id)))
    .orderBy(desc(workSessions.startedAt))
    .limit(50);
  return NextResponse.json({ runs });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job.length) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const settings = await getSettings();
  if (settings.paused) return NextResponse.json({ error: "Agent is paused" }, { status: 409 });

  // Don't start a second run of a job that's already running (#27), or a
  // turn in a conversation that's busy (#18).
  const runningOfJob = await db
    .select({ id: workSessions.id })
    .from(workSessions)
    .where(and(eq(workSessions.jobId, jobId), eq(workSessions.status, "running")))
    .limit(1);
  if (runningOfJob.length) return NextResponse.json({ error: "This job is already running." }, { status: 409 });
  if (job[0].conversationId && isConversationBusy(job[0].conversationId)) {
    return NextResponse.json(
      { error: "The agent is already working in this job's conversation. Try again when it's done." },
      { status: 409 },
    );
  }

  let convId = job[0].conversationId;
  if (!convId) {
    const inserted = await db.insert(conversations).values({ title: `Job: ${job[0].name}`, agentId: job[0].agentId }).returning();
    await db.update(jobs).set({ conversationId: inserted[0].id, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    convId = inserted[0].id;
  }

  const j = job[0];
  const trigger = j.kind === "daily_report" ? "report" as const : "scheduled" as const;
  const eventNote = j.kind === "daily_report"
    ? `[DAILY REPORT — manual trigger] It's time for your daily self-report. Look back at what you did over the past day (journal, sessions, tool executions), summarize it, note what you spent, and write your plan for today into your journal (category=reflection).`
    : j.kind === "self_work"
      ? `[SELF-DIRECTED WORK — manual trigger] Your initiative window is open (up to ${j.maxDurationMinutes} minutes). Review your goals and journal, pick the highest-value goal, and take real action on it — explore, build, test, or automate something. Act, don't plan. Journal what you did. Only notify the human if something genuinely needs their input.`
      : `[SCHEDULED WORK — manual trigger] Your scheduled job "${j.name}" is due (up to ${j.maxDurationMinutes} minutes). ${j.instruction ? `Job instructions: ${j.instruction}` : "Decide what to do and get to work."}`;

  await db.update(jobs).set({ lastRunAt: new Date(), lastStatus: "running", lastError: null, updatedAt: new Date() }).where(eq(jobs.id, jobId));

  runAgentTurn({ conversationId: convId, eventNote, trigger, jobId: j.id, maxDurationMinutes: j.maxDurationMinutes })
    .then(async () => {
      await db.update(jobs).set({ lastStatus: "completed", updatedAt: new Date() }).where(eq(jobs.id, jobId));
    })
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Lost the race for a busy conversation: nothing ran.
      const lastStatus = err instanceof TurnBusyError ? "skipped" : "failed";
      await db.update(jobs).set({ lastStatus, lastError: msg, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    });

  return NextResponse.json({ ok: true, conversationId: convId }, { status: 202 });
}
