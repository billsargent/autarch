import fs from "node:fs";
import path from "node:path";
import { db, sqlite } from "@/db";
import { goals, journalEntries } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// The memory model (#66, docs/agents.md): goals with notes for where work
// stands, skills for how-tos, a diary written for the villager after each
// session, conversation summaries, and one way to message the owner.

// Sessions that are only a part of something else (answering a question, a
// meeting, a vote, an interview, a review, an approval's follow-up) don't get
// a diary entry of their own.
const QUIET_TRIGGERS = new Set(["message", "meeting", "vote", "interview", "review", "approval", "research"]);

// After a session: a short diary entry of what was done (#69). Work windows
// always get one; a chat only when tools were used. No model call.
export async function autoJournal(sessionId: number): Promise<number | null> {
  const s = sqlite
    .prepare(
      `SELECT ws.trigger, ws.agent_id AS agentId, ws.conversation_id AS conversationId, ws.started_at AS startedAt, ws.cost_usd AS cost,
              ws.actions_used AS actions, ws.status, j.name AS jobName, j.kind AS jobKind, c.title AS conversationTitle
       FROM work_sessions ws LEFT JOIN jobs j ON j.id = ws.job_id LEFT JOIN conversations c ON c.id = ws.conversation_id
       WHERE ws.id = ?`,
    )
    .get(sessionId) as
    | { trigger: string; agentId: number | null; conversationId: number | null; startedAt: number; cost: number; actions: number; status: string; jobName: string | null; jobKind: string | null; conversationTitle: string | null }
    | undefined;
  if (!s || QUIET_TRIGGERS.has(s.trigger)) return null;
  const work = s.trigger === "scheduled" || s.trigger === "report";
  if (!work && !s.actions) return null;

  const tools = sqlite
    .prepare("SELECT tool, COUNT(*) AS n FROM tool_executions WHERE conversation_id = ? AND agent_id IS ? AND requested_at >= ? GROUP BY tool ORDER BY n DESC")
    .all(s.conversationId, s.agentId, s.startedAt) as Array<{ tool: string; n: number }>;
  const said = sqlite
    .prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' AND TRIM(COALESCE(content, '')) <> '' AND created_at >= ? ORDER BY id DESC LIMIT 1")
    .get(s.conversationId, s.startedAt) as { content: string } | undefined;

  const title =
    s.jobKind === "daydream" ? "Village life" : s.trigger === "report" ? "Daily report" : work ? `Work: ${s.jobName ?? "scheduled job"}` : `Chat: ${s.conversationTitle ?? "a conversation"}`;
  const body = [
    tools.length ? `Used ${tools.map((t) => (t.n > 1 ? `${t.tool} ×${t.n}` : t.tool)).join(", ")}.` : "No tools used.",
    said ? `Ended with: "${said.content.replace(/\s+/g, " ").slice(0, 280)}${said.content.length > 280 ? "…" : ""}"` : "",
    s.status !== "completed" ? `Stopped early (${s.status}).` : "",
    `Cost $${s.cost.toFixed(4)}.`,
  ]
    .filter(Boolean)
    .join("\n");
  const [row] = await db.insert(journalEntries).values({ title, body, category: "task", status: "done", agentId: s.agentId }).returning();
  return row.id;
}

// A villager's old notes/plan.md moves into the notes of a goal, once (#71).
export async function importPlanFile(agent: { id: number; home: string }, workspaceDir: string): Promise<boolean> {
  const file = path.join(workspaceDir, agent.home, "notes", "plan.md");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8").trim();
  } catch {
    return false;
  }
  try {
    fs.renameSync(file, `${file}.imported`);
  } catch {
    return false;
  }
  if (!text) return false;
  const [existing] = await db.select().from(goals).where(and(eq(goals.agentId, agent.id), eq(goals.title, "Ongoing work"))).limit(1);
  const notes = `${existing?.notes ? `${existing.notes}\n` : ""}(From notes/plan.md)\n${text}`.slice(-6000);
  if (existing) await db.update(goals).set({ notes, updatedAt: new Date() }).where(eq(goals.id, existing.id));
  else await db.insert(goals).values({ title: "Ongoing work", body: "What was in notes/plan.md before goals had notes.", status: "in_progress", priority: 3, agentId: agent.id, notes });
  return true;
}
