import { sqlite } from "@/db";
import { listVillagers, spentToday } from "./agents";

// How each villager is doing (#104), worked out from the record: no model
// calls. Good work and kind notes lift it; dropped work, an empty budget and
// being ignored by the owner pull it down. Every point comes with a reason.

export interface MoraleStats {
  approved: number; // actions that ran, last 7 days
  dropped: number; // denied, failed, blocked or rate-limited, last 7 days
  daysSinceOwner: number | null; // since the owner last talked to them; null = never
  notesReceived: number; // neighbours' notes about them, last 7 days
  budgetSpent: boolean; // today's budget used up
}

export function moraleScore(s: MoraleStats): { score: number; reasons: string[] } {
  let score = 60;
  const reasons: string[] = [];
  if (s.approved) {
    const up = Math.min(20, s.approved * 2);
    score += up;
    reasons.push(`${s.approved} thing${s.approved === 1 ? "" : "s"} done this week (+${up})`);
  }
  if (s.dropped) {
    const down = Math.min(25, s.dropped * 3);
    score -= down;
    reasons.push(`${s.dropped} dropped or refused (−${down})`);
  }
  const days = s.daysSinceOwner ?? 7;
  if (days >= 2) {
    const down = Math.min(25, days * 3);
    score -= down;
    reasons.push(s.daysSinceOwner == null ? `you haven't talked to them yet (−${down})` : `${days} days since you talked (−${down})`);
  }
  if (s.notesReceived) {
    const up = Math.min(10, s.notesReceived * 2);
    score += up;
    reasons.push(`${s.notesReceived} note${s.notesReceived === 1 ? "" : "s"} from neighbours (+${up})`);
  }
  if (s.budgetSpent) {
    score -= 10;
    reasons.push("today's budget is spent (−10)");
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export async function villageMorale(now = Date.now()) {
  const week = Math.floor(now / 1000) - 7 * 86400;
  const villagers = await listVillagers();
  return villagers.map((v) => {
    const count = (sql: string, ...args: unknown[]) => (sqlite.prepare(sql).get(...args) as { n: number }).n;
    const approved = count("SELECT COUNT(*) AS n FROM tool_executions WHERE agent_id = ? AND status IN ('success', 'approved') AND requested_at >= ?", v.id, week);
    const dropped = count("SELECT COUNT(*) AS n FROM tool_executions WHERE agent_id = ? AND status IN ('denied', 'error', 'blocked', 'rate_limited') AND requested_at >= ?", v.id, week);
    const notesReceived = count("SELECT COUNT(*) AS n FROM journal_entries WHERE subject_agent_id = ? AND created_at >= ?", v.id, week);
    const last = sqlite
      .prepare("SELECT MAX(m.created_at) AS t FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.agent_id = ? AND m.role = 'user'")
      .get(v.id) as { t: number | null };
    const daysSinceOwner = last.t ? Math.floor((now / 1000 - last.t) / 86400) : null;
    const budgetSpent = v.dailyBudgetUsd != null && spentToday(v.id, new Date(now)) >= v.dailyBudgetUsd;
    return { agentId: v.id, name: v.name, ...moraleScore({ approved, dropped, daysSinceOwner, notesReceived, budgetSpent }) };
  });
}
