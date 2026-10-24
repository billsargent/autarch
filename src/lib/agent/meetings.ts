import { db, sqlite } from "@/db";
import { agents, conversations, meetings, messages, notifications } from "@/db/schema";
import { and, asc, eq, gt, ne } from "drizzle-orm";
import { budgetProblem, ensureMayor, type AgentRow } from "./agents";
import { isNight } from "./daynight";
import { getSettings } from "./settingsStore";

// Town meetings (#81, docs/town-charter.md section 7). The owner (or the
// Mayor) calls one; every awake, working villager attends. Each question
// gets an answer from each villager in turn: a talk-only turn of their own,
// in their own meeting thread, where they hear what's been said since they
// last spoke. The answers go into the meeting's transcript (a conversation
// of the Mayor's). A meeting has a cost cap; when it's spent, the round stops.

export type MeetingRow = typeof meetings.$inferSelect;
type Threads = Record<string, { conversationId: number; heard: number }>;

// At most this many answer each question: the Mayor first, then the rest in
// the order they joined the village.
export const SPEAKERS_PER_ROUND = 6;
// A meeting nobody closed ends by itself after this long.
const MEETING_HOURS = 4;

export class MeetingError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export async function currentMeeting(): Promise<MeetingRow | null> {
  const [m] = await db.select().from(meetings).where(eq(meetings.status, "open")).orderBy(asc(meetings.id)).limit(1);
  if (!m) return null;
  if (Date.now() - m.createdAt.getTime() > MEETING_HOURS * 3600_000) {
    await closeMeeting(m.id);
    return null;
  }
  return m;
}

// Calls a meeting, or returns the one already going.
export async function callMeeting(calledBy: "owner" | "mayor", topic?: string | null): Promise<MeetingRow> {
  const open = await currentMeeting();
  if (open) return open;
  const settings = await getSettings();
  if (settings.paused) throw new MeetingError("Everyone is paused. Resume them first.");
  if (isNight(new Date(), settings.bedtime, settings.wakeTime)) throw new MeetingError(`Everyone's asleep. Meetings are held in the daytime (after ${settings.wakeTime}).`);
  const mayor = await ensureMayor();
  const attending = await db.select().from(agents).where(eq(agents.status, "active")).orderBy(asc(agents.id));
  const order = [mayor.id, ...attending.filter((a) => a.id !== mayor.id).map((a) => a.id)].filter((id) => attending.some((a) => a.id === id));
  const title = `Town meeting${topic ? `: ${topic}` : ""} — ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })}`;
  const [conv] = await db.insert(conversations).values({ title, agentId: mayor.id, chatMode: "conversation" }).returning();
  const [m] = await db
    .insert(meetings)
    .values({ topic: topic?.trim() || null, calledBy, conversationId: conv.id, participants: order, threads: {} })
    .returning();
  return m;
}

export async function closeMeeting(id: number) {
  await db.update(meetings).set({ status: "closed", endedAt: new Date(), speakingAgentId: null }).where(eq(meetings.id, id));
}

// What the meeting has spent: every turn in its villagers' threads.
export function meetingCost(m: MeetingRow): number {
  const ids = Object.values((m.threads as Threads | null) ?? {}).map((t) => t.conversationId);
  if (!ids.length) return 0;
  const row = sqlite
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS c FROM work_sessions WHERE conversation_id IN (${ids.map(() => "?").join(",")})`)
    .get(...ids) as { c: number };
  return row.c;
}

const running = new Set<number>();

// Puts a question to the meeting and starts a round of answers (in the
// background; poll meetingView). `from` is the owner or a villager (the
// Mayor opening his own meeting), who doesn't answer themselves.
export async function askMeeting(id: number, question: string, from: { agentId: number; name: string } | null = null): Promise<void> {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!m || m.status !== "open") throw new MeetingError("That meeting is over.");
  const text = question.trim();
  if (!text) throw new MeetingError("Say something to the meeting.", 400);
  if (running.has(id) || m.speakingAgentId) throw new MeetingError("Someone's still answering. Wait for the round to finish.");
  await db.insert(messages).values(
    from ? { conversationId: m.conversationId!, role: "event", content: `[${from.name}] ${text}` } : { conversationId: m.conversationId!, role: "user", content: text },
  );
  running.add(id);
  void runRound(id, from?.agentId ?? null).finally(() => running.delete(id));
}

async function runRound(id: number, askerId: number | null) {
  const say = (content: string, conversationId: number) => db.insert(messages).values({ conversationId, role: "event", content });
  try {
    const [m0] = await db.select().from(meetings).where(eq(meetings.id, id));
    const speakers = (m0.participants as number[]).filter((a) => a !== askerId).slice(0, SPEAKERS_PER_ROUND);
    for (const agentId of speakers) {
      const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
      if (m.status !== "open") return;
      const settings = await getSettings();
      if (meetingCost(m) >= settings.meetingCostCapUsd) {
        await say(`[Meeting] The meeting has spent its budget ($${settings.meetingCostCapUsd.toFixed(2)}), so the round ends here.`, m.conversationId!);
        return;
      }
      const [agent] = await db.select().from(agents).where(and(eq(agents.id, agentId), ne(agents.status, "dismissed")));
      if (!agent || agent.status !== "active" || budgetProblem(agent, settings)) continue;
      const threads = { ...((m.threads as Threads | null) ?? {}) };
      const thread = threads[agentId] ?? { conversationId: await newThread(agent, m), heard: 0 };
      // What's been said since they last heard.
      const fresh = await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, m.conversationId!), gt(messages.id, thread.heard)))
        .orderBy(asc(messages.id));
      const lines = fresh.map((r) => (r.role === "user" ? `The owner: ${r.content}` : (r.content ?? "").replace(/^\[([^\]]+)\] /, "$1: "))).filter((l) => !l.startsWith(`${agent.name}: `));
      await db.update(meetings).set({ speakingAgentId: agentId }).where(eq(meetings.id, id));
      let answer = "";
      try {
        const { runWhenFree } = await import("./runner");
        const result = await runWhenFree({ conversationId: thread.conversationId, eventNote: `[Town meeting]\n${lines.join("\n")}`, trigger: "meeting" }, 2000, 5 * 60_000);
        answer = [...result.newMessages].reverse().find((r) => r.role === "assistant" && r.content?.trim())?.content?.trim() ?? "";
        // Models sometimes echo the transcript's "Name:" in front of their answer.
        // "Gus: …", "**Gus:** …" or "**Gus**: …".
        answer = answer.replace(new RegExp(`^\\**\\s*${agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\**\\s*:\\s*\\**\\s*`, "i"), "");
      } catch (err) {
        answer = "";
        await say(`[Meeting] ${agent.name} couldn't answer: ${err instanceof Error ? err.message : String(err)}`, m.conversationId!);
      }
      const [said] = answer ? await db.insert(messages).values({ conversationId: m.conversationId!, role: "event", content: `[${agent.name}] ${answer}` }).returning() : [];
      threads[agentId] = { conversationId: thread.conversationId, heard: said?.id ?? fresh[fresh.length - 1]?.id ?? thread.heard };
      await db.update(meetings).set({ threads, speakingAgentId: null }).where(eq(meetings.id, id));
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, m.conversationId!));
    }
  } finally {
    await db.update(meetings).set({ speakingAgentId: null }).where(eq(meetings.id, id));
  }
}

async function newThread(agent: AgentRow, m: MeetingRow): Promise<number> {
  const [conv] = await db
    .insert(conversations)
    .values({ title: `Town meeting #${m.id}${m.topic ? `: ${m.topic}` : ""}`, agentId: agent.id, chatMode: "conversation" })
    .returning();
  return conv.id;
}

// The meeting as the town hall shows it.
export async function meetingView(m: MeetingRow) {
  const transcript = await db.select().from(messages).where(eq(messages.conversationId, m.conversationId!)).orderBy(asc(messages.id));
  const settings = await getSettings();
  return {
    meeting: { id: m.id, topic: m.topic, calledBy: m.calledBy, status: m.status, participants: m.participants as number[], speakingAgentId: m.speakingAgentId, createdAt: m.createdAt },
    transcript: transcript.map((r) => {
      const named = /^\[([^\]]+)\] ([\s\S]*)$/.exec(r.content ?? "");
      return r.role === "user"
        ? { id: r.id, who: "You", text: r.content ?? "" }
        : { id: r.id, who: named?.[1] ?? "Meeting", text: named?.[2] ?? r.content ?? "" };
    }),
    cost: meetingCost(m),
    cap: settings.meetingCostCapUsd,
    busy: running.has(m.id) || m.speakingAgentId != null,
  };
}

// Who is at the meeting now (for the village to walk them to the town hall).
export function inMeeting(): Set<number> {
  const row = sqlite.prepare("SELECT participants FROM meetings WHERE status = 'open' ORDER BY id LIMIT 1").get() as { participants: string } | undefined;
  return new Set(row ? (JSON.parse(row.participants) as number[]) : []);
}

// The Mayor's call_meeting tool: call one and open it with the topic.
export async function mayorCallsMeeting(mayor: AgentRow, topic: string) {
  const m = await callMeeting("mayor", topic);
  await db.insert(notifications).values({ kind: "meeting", title: `${mayor.name} called a town meeting`, body: topic, severity: "info", source: mayor.name, agentId: mayor.id });
  await askMeeting(m.id, topic, { agentId: mayor.id, name: mayor.name });
  return m;
}
