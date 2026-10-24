import { db, sqlite } from "@/db";
import { conversations, toolExecutions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { budgetProblem, ensureMayor, getAgent } from "./agents";
import { isNight } from "./daynight";
import { getSettings, type AgentSettingsRow } from "./settingsStore";

// Away mode (#102, docs/town-charter.md section 2). While the owner is away,
// the Mayor looks at requests waiting for approval and may approve the small
// ones. He never decides anything high-risk or worse, never his own requests,
// never at night, and never once the village has spent the away budget. He
// never denies: what he doesn't approve waits for the owner.

const REVIEWABLE = ["low", "medium"];
const REVIEW_TITLE = "Away-mode reviews";

export function awayActive(settings: Pick<AgentSettingsRow, "awayUntil">, now = Date.now()): boolean {
  return settings.awayUntil != null && settings.awayUntil.getTime() > now;
}

// What the whole village has spent since the owner went away.
export function awaySpent(settings: Pick<AgentSettingsRow, "awayStartedAt">): number {
  if (!settings.awayStartedAt) return 0;
  const since = Math.floor(settings.awayStartedAt.getTime() / 1000);
  return (sqlite.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM work_sessions WHERE started_at >= ?").get(since) as { c: number }).c;
}

export function parseDecision(text: string): "approve" | "leave" {
  return /DECISION:\s*APPROVE/i.test(text) ? "approve" : "leave";
}

// Why the Mayor may not look at this request; null if he may.
export function whyNotReviewable(
  settings: AgentSettingsRow,
  request: { status: string; riskLevel: string; agentId: number | null },
  mayorId: number,
  now = new Date(),
): string | null {
  if (!awayActive(settings, now.getTime())) return "the owner isn't away";
  if (request.status !== "awaiting_approval") return "already decided";
  if (!REVIEWABLE.includes(request.riskLevel)) return "too risky; only the owner decides";
  if (request.agentId === mayorId) return "it's the Mayor's own request";
  if (isNight(now, settings.bedtime, settings.wakeTime)) return "night";
  if (settings.paused) return "everyone is paused";
  if (awaySpent(settings) >= settings.awaySpendCapUsd) return "the away budget is spent";
  return null;
}

async function reviewConversation(mayorId: number): Promise<number> {
  const [found] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.agentId, mayorId), eq(conversations.title, REVIEW_TITLE)))
    .limit(1);
  if (found) return found.id;
  const [made] = await db.insert(conversations).values({ title: REVIEW_TITLE, agentId: mayorId, chatMode: "conversation" }).returning();
  return made.id;
}

export async function considerWhileAway(executionId: number): Promise<"approved" | "left" | "skipped"> {
  const settings = await getSettings();
  if (!awayActive(settings)) return "skipped";
  const [request] = await db.select().from(toolExecutions).where(eq(toolExecutions.id, executionId));
  if (!request) return "skipped";
  const mayor = await ensureMayor();
  if (whyNotReviewable(settings, request, mayor.id) || mayor.status !== "active" || budgetProblem(mayor, settings)) return "skipped";

  const asker = await getAgent(request.agentId);
  const note = [
    `[Approval request #${request.id}] ${asker.name} (${asker.role}) wants to use ${request.tool} (risk: ${request.riskLevel}).`,
    request.riskReason ? `Why it needs approval: ${request.riskReason}` : "",
    `What it would do:\n${JSON.stringify(request.input ?? {}, null, 2).slice(0, 2000)}`,
    `The owner is away until ${settings.awayUntil!.toLocaleString()}.`,
  ]
    .filter(Boolean)
    .join("\n");
  let text = "";
  try {
    const { runWhenFree } = await import("./runner");
    const result = await runWhenFree({ conversationId: await reviewConversation(mayor.id), eventNote: note, trigger: "review" }, 2000, 10 * 60_000);
    text = [...result.newMessages].reverse().find((m) => m.role === "assistant" && m.content?.trim())?.content ?? "";
  } catch {
    return "left";
  }
  if (parseDecision(text) !== "approve") return "left";
  // Things may have changed while he thought it over.
  const [now] = await db.select().from(toolExecutions).where(eq(toolExecutions.id, executionId));
  if (!now || whyNotReviewable(await getSettings(), now, mayor.id)) return "left";
  const { resolveApproval } = await import("./runner");
  try {
    await resolveApproval(executionId, "approved", undefined, "mayor-away");
    return "approved";
  } catch {
    return "left";
  }
}

// What the Mayor decided while the owner was away, for the welcome back.
export function awayDecisions(settings: Pick<AgentSettingsRow, "awayStartedAt">) {
  if (!settings.awayStartedAt) return [];
  return sqlite
    .prepare(
      "SELECT id, tool, status, risk_level AS riskLevel, agent_id AS agentId, resolved_at AS resolvedAt FROM tool_executions WHERE resolved_by = 'mayor-away' AND resolved_at >= ? ORDER BY id DESC",
    )
    .all(Math.floor(settings.awayStartedAt.getTime() / 1000)) as Array<{ id: number; tool: string; status: string; riskLevel: string; agentId: number | null; resolvedAt: number }>;
}
