import { db, sqlite } from "@/db";
import { agents, conversations, goals, jobs, notifications } from "@/db/schema";
import { and, eq, ne, notInArray } from "drizzle-orm";
import { budgetProblem, spentToday, type AgentRow } from "./agents";
import { getSettings } from "./settingsStore";
import { scheduleJob, type ToolContext } from "./tools";
import { requestCancel } from "./turnLock";

// The Mayor's powers (#58, docs/town-charter.md section 3). Each is a tool, so
// it goes through the risk gate, the rate limits and the activity log like any
// other. What stays with the owner has no tool at all: approvals, settings,
// overrides, the global pause, limits and dismissal. These checks are made
// here, against the database, not trusted to the tool list or the prompt.

export const FLAGS_PER_HOUR = 5;

type Result = { output: string; summary: string };
const refused = (output: string): Result => ({ output: `Refused: ${output}`, summary: "mayor refused" });

// The calling villager, if it is the Mayor; otherwise a refusal.
async function theMayor(ctx?: ToolContext): Promise<AgentRow | Result> {
  if (!ctx?.agentId) return refused("only the Mayor can do that.");
  const [me] = await db.select().from(agents).where(eq(agents.id, ctx.agentId));
  if (!me?.isMayor || me.status === "dismissed") return refused("only the Mayor can do that.");
  return me;
}

// A neighbour's question can't steer the Mayor into acting on someone.
function notWhileAnswering(ctx?: ToolContext): Result | null {
  return ctx?.trigger === "message"
    ? refused("you're answering a neighbour right now. Act on what they said later, in your own time, if it still seems right.")
    : null;
}

async function findVillager(name: unknown): Promise<AgentRow | Result> {
  const wanted = String(name ?? "").trim();
  if (!wanted) return refused("say which villager (`name`).");
  const everyone = await db.select().from(agents).where(ne(agents.status, "dismissed"));
  const hit = everyone.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
  return hit ?? refused(`nobody called "${wanted}" lives in the village. Villagers: ${everyone.map((a) => a.name).join(", ")}.`);
}

const isResult = (x: unknown): x is Result => typeof x === "object" && x !== null && "output" in x;

function tellOwner(title: string, body: string | null, mayor: AgentRow, severity: "info" | "warning" = "info") {
  return db.insert(notifications).values({ title, body, severity, source: mayor.name, agentId: mayor.id });
}

export async function runMayorTool(tool: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<Result> {
  const mayor = await theMayor(ctx);
  if (isResult(mayor)) return mayor;
  switch (tool) {
    case "assign_goal":
      return assignGoal(mayor, args, ctx);
    case "schedule_job_for":
      return scheduleJobFor(mayor, args, ctx);
    case "review_agent":
      return reviewAgent(args);
    case "flag":
      return flag(mayor, args);
    case "pause_agent":
      return pauseAgent(mayor, args, ctx);
    case "resume_agent":
      return resumeAgent(mayor, args, ctx);
    default:
      return refused(`unknown power "${tool}".`);
  }
}

// Work only goes to villagers who can do it.
function cantTakeWork(target: AgentRow): Result | null {
  if (target.status === "paused") return refused(`${target.name} is paused and can't take work.`);
  return null;
}

async function assignGoal(mayor: AgentRow, args: Record<string, unknown>, ctx?: ToolContext): Promise<Result> {
  const busy = notWhileAnswering(ctx);
  if (busy) return busy;
  const target = await findVillager(args.to);
  if (isResult(target)) return target;
  const no = cantTakeWork(target);
  if (no) return no;
  const title = String(args.title ?? "").trim();
  if (!title) return refused("a goal needs a `title`.");
  const priority = Math.min(5, Math.max(1, Number(args.priority) || 3));
  const [goal] = await db
    .insert(goals)
    .values({ title, body: args.body ? String(args.body) : null, priority, status: "backlog", agentId: target.id })
    .returning();
  return {
    output: `Gave ${target.name} goal #${goal.id}: ${title} (priority ${priority}). It's on their goals board.`,
    summary: `assign goal #${goal.id} to ${target.name}`,
  };
}

async function scheduleJobFor(mayor: AgentRow, args: Record<string, unknown>, ctx?: ToolContext): Promise<Result> {
  const busy = notWhileAnswering(ctx);
  if (busy) return busy;
  const target = await findVillager(args.to);
  if (isResult(target)) return target;
  const no = cantTakeWork(target);
  if (no) return no;
  const broke = budgetProblem(target, await getSettings());
  if (broke) return refused(broke);
  if (!String(args.name ?? "").trim()) return refused("a job needs a `name`.");
  // Always a new job, owned by the villager; their own jobs stay theirs to change.
  const fresh: Record<string, unknown> = { ...args, enabled: true };
  delete fresh.jobId;
  const made = await scheduleJob(fresh, { agentId: target.id, agentName: target.name, conversationId: null });
  return { output: made.output.replace(/^Created job/, `Scheduled for ${target.name}: job`), summary: `job for ${target.name}` };
}

async function reviewAgent(args: Record<string, unknown>): Promise<Result> {
  const target = await findVillager(args.name);
  if (isResult(target)) return target;
  const sessions = sqlite
    .prepare(
      "SELECT trigger, status, reason, cost_usd AS cost, started_at AS at FROM work_sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 8",
    )
    .all(target.id) as Array<{ trigger: string; status: string; reason: string | null; cost: number; at: number }>;
  const calls = sqlite
    .prepare("SELECT tool, status, risk_level AS risk, summary FROM tool_executions WHERE agent_id = ? ORDER BY id DESC LIMIT 12")
    .all(target.id) as Array<{ tool: string; status: string; risk: string; summary: string | null }>;
  const theirGoals = await db
    .select()
    .from(goals)
    .where(and(eq(goals.agentId, target.id), notInArray(goals.status, ["done", "abandoned"])))
    .orderBy(goals.priority);
  const theirJobs = await db.select().from(jobs).where(and(eq(jobs.agentId, target.id), eq(jobs.enabled, true)));
  const budget = target.dailyBudgetUsd != null ? ` of $${target.dailyBudgetUsd.toFixed(2)}` : "";
  const when = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ");
  const lines = [
    `${target.name} (${target.role}) — ${target.status}${target.pausedBy ? ` (paused by the ${target.pausedBy})` : ""}. Spent today: $${spentToday(target.id).toFixed(4)}${budget}.`,
    `Recent work sessions:`,
    ...(sessions.length ? sessions.map((s) => `- ${when(s.at)} ${s.trigger}: ${s.status}${s.reason ? ` (${s.reason})` : ""}, $${s.cost.toFixed(4)}`) : ["- none"]),
    `Recent tool calls:`,
    ...(calls.length ? calls.map((c) => `- ${c.tool} [${c.status}, ${c.risk}]${c.summary ? ` ${c.summary}` : ""}`) : ["- none"]),
    `Open goals: ${theirGoals.length ? theirGoals.map((g) => `#${g.id} ${g.title} (${g.status})`).join("; ") : "none"}.`,
    `Active jobs: ${theirJobs.length ? theirJobs.map((j) => `#${j.id} ${j.name}`).join("; ") : "none"}.`,
  ];
  return { output: lines.join("\n"), summary: `review ${target.name}` };
}

async function flag(mayor: AgentRow, args: Record<string, unknown>): Promise<Result> {
  const title = String(args.title ?? "").trim();
  if (!title) return refused("a flag needs a `title`.");
  const since = Math.floor(Date.now() / 1000) - 3600;
  const { n } = sqlite
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE agent_id = ? AND kind = 'flag' AND created_at >= ?")
    .get(mayor.id, since) as { n: number };
  if (n >= FLAGS_PER_HOUR) return refused(`you've flagged ${FLAGS_PER_HOUR} things in the last hour. Save the rest for later.`);
  const severity = args.severity === "critical" || args.severity === "warning" ? args.severity : "info";
  await db.insert(notifications).values({
    kind: "flag",
    title,
    body: args.body ? String(args.body) : null,
    severity,
    source: mayor.name,
    agentId: mayor.id,
  });
  return { output: `Flagged for the owner: ${title}.`, summary: "flag" };
}

async function pauseAgent(mayor: AgentRow, args: Record<string, unknown>, ctx?: ToolContext): Promise<Result> {
  const busy = notWhileAnswering(ctx);
  if (busy) return busy;
  const target = await findVillager(args.name);
  if (isResult(target)) return target;
  if (target.id === mayor.id || target.isMayor) return refused("you can't pause yourself. Only the owner can pause the Mayor.");
  if (target.status === "paused") return refused(`${target.name} is already paused.`);
  const reason = String(args.reason ?? "").trim();
  if (!reason) return refused("say why (`reason`); the owner will see it.");
  await db.update(agents).set({ status: "paused", pausedBy: "mayor", updatedAt: new Date() }).where(eq(agents.id, target.id));
  const theirs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.agentId, target.id));
  for (const c of theirs) requestCancel(c.id);
  await tellOwner(`${mayor.name} paused ${target.name}`, reason, mayor, "warning");
  return { output: `Paused ${target.name}. The owner has been told why. You can let them work again with resume_agent.`, summary: `pause ${target.name}` };
}

async function resumeAgent(mayor: AgentRow, args: Record<string, unknown>, ctx?: ToolContext): Promise<Result> {
  const busy = notWhileAnswering(ctx);
  if (busy) return busy;
  const target = await findVillager(args.name);
  if (isResult(target)) return target;
  if (target.status !== "paused") return refused(`${target.name} isn't paused.`);
  if (target.pausedBy !== "mayor") return refused(`the owner paused ${target.name}; only the owner can let them work again.`);
  await db.update(agents).set({ status: "active", pausedBy: null, updatedAt: new Date() }).where(eq(agents.id, target.id));
  await tellOwner(`${mayor.name} let ${target.name} work again`, args.reason ? String(args.reason) : null, mayor);
  return { output: `${target.name} can work again.`, summary: `resume ${target.name}` };
}
