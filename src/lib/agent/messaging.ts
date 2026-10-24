import { db, sqlite } from "@/db";
import { agents, conversations, messages } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { budgetProblem } from "./agents";
import { isNight } from "./daynight";
import { getSettings } from "./settingsStore";
import type { ToolContext } from "./tools";

// Villagers asking each other things (#57). A question lands in a thread
// owned by the villager being asked (their conversation, with the asker as
// partner), and they answer in their own turn, on their own budget. The
// answer is posted back into the asker's conversation without starting a
// turn for them, so two villagers can't ping-pong: they see it next time.
// A villager answering a question can't send questions onward in that turn,
// and each pair is limited to a few questions an hour.

export const ASKS_PER_PAIR_PER_HOUR = 4;

const refused = (output: string) => ({ output: `Refused: ${output}`, summary: "ask refused" });

// Questions `from` sent `to` in the last hour (their thread's "asks" notes).
function recentAsks(threadId: number, fromName: string): number {
  const since = Math.floor(Date.now() / 1000) - 3600;
  const row = sqlite
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'event' AND content LIKE ? AND created_at >= ?")
    .get(threadId, `[${fromName} asks]%`, since) as { n: number };
  return row.n;
}

export async function askVillager(args: Record<string, unknown>, ctx?: ToolContext) {
  const toName = String(args.to ?? "").trim();
  const question = String(args.message ?? "").trim();
  if (!ctx?.agentId || !ctx.agentName) return refused("only a villager can ask another villager.");
  if (!toName || !question) return refused("say who to ask (`to`) and what (`message`).");
  if (ctx.trigger === "message") {
    return refused("you're answering a neighbour right now, so you can't send questions onward. Answer them; you can ask others later.");
  }

  const everyone = await db.select().from(agents).where(ne(agents.status, "dismissed"));
  const target = everyone.find((a) => a.name.toLowerCase() === toName.toLowerCase());
  if (!target) return refused(`nobody called "${toName}" lives in the village. Neighbours: ${everyone.filter((a) => a.id !== ctx.agentId).map((a) => a.name).join(", ") || "none"}.`);
  if (target.id === ctx.agentId) return refused("that's you.");
  if (target.status === "paused") return refused(`${target.name} is resting (paused by the human) and can't answer.`);

  const settings = await getSettings();
  if (settings.paused) return refused("everyone is paused.");
  if (isNight(new Date(), settings.bedtime, settings.wakeTime)) {
    return refused(`${target.name} is asleep. Ask in the morning (after ${settings.wakeTime}).`);
  }
  const broke = budgetProblem(target, settings);
  if (broke) return refused(broke);

  // Their thread with you: one conversation per pair, owned by them.
  let [thread] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.agentId, target.id), eq(conversations.partnerAgentId, ctx.agentId)))
    .limit(1);
  if (!thread) {
    [thread] = await db
      .insert(conversations)
      .values({ title: `${ctx.agentName} ↔ ${target.name}`, agentId: target.id, partnerAgentId: ctx.agentId })
      .returning();
  }
  if (recentAsks(thread.id, ctx.agentName) >= ASKS_PER_PAIR_PER_HOUR) {
    return refused(`you've asked ${target.name} ${ASKS_PER_PAIR_PER_HOUR} times in the last hour. Give them a rest.`);
  }

  // Deliver in the background: the asker's turn carries on, and the answer
  // comes back as a note in the asker's conversation.
  const replyTo = ctx.conversationId ?? null;
  const from = ctx.agentName;
  void deliver(thread.id, target.name, from, question, replyTo);

  return {
    output: `Sent to ${target.name}. Their answer will be posted in this conversation when they reply; you'll see it next time you're here.`,
    summary: `ask ${target.name}`,
  };
}

async function deliver(threadId: number, toName: string, fromName: string, question: string, replyTo: number | null) {
  const post = async (content: string) => {
    if (!replyTo) return;
    await db.insert(messages).values({ conversationId: replyTo, role: "event", content });
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, replyTo));
  };
  try {
    const { runWhenFree } = await import("./runner");
    const result = await runWhenFree({ conversationId: threadId, eventNote: `[${fromName} asks] ${question}`, trigger: "message" }, 3000, 15 * 60_000);
    const answer = [...result.newMessages].reverse().find((m) => m.role === "assistant" && m.content?.trim())?.content?.trim();
    await post(answer ? `[Reply from ${toName}] ${answer}` : `[${toName} didn't answer]`);
  } catch (err) {
    await post(`[${toName} couldn't answer] ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
  }
}

// What villagers have asked each other, newest first, for the guard tower's
// "neighbours' talk" log. Each question is an "[X asks]" note in the asked
// villager's thread with X; the answer is their next reply in that thread.
export interface NeighbourExchange {
  id: number; // the question's message id
  conversationId: number;
  fromId: number | null; // who asked
  toId: number | null; // who was asked
  question: string;
  askedAt: number; // ms
  answer: string | null; // null = not answered (yet)
  answeredAt: number | null;
}

export function neighbourTalk(limit = 100): NeighbourExchange[] {
  const asks = sqlite
    .prepare(
      `SELECT m.id, m.conversation_id AS conversationId, m.content, m.created_at AS at, c.agent_id AS toId, c.partner_agent_id AS fromId
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.partner_agent_id IS NOT NULL AND m.role = 'event' AND m.content LIKE '[% asks] %'
       ORDER BY m.id DESC LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; conversationId: number; content: string; at: number; toId: number | null; fromId: number | null }>;
  const reply = sqlite.prepare(
    `SELECT content, created_at AS at FROM messages
     WHERE conversation_id = ? AND id > ? AND role = 'assistant' AND TRIM(COALESCE(content, '')) <> ''
       AND id < COALESCE((SELECT MIN(id) FROM messages WHERE conversation_id = ? AND id > ? AND role = 'event' AND content LIKE '[% asks] %'), 1e18)
     ORDER BY id DESC LIMIT 1`,
  );
  return asks.map((a) => {
    const r = reply.get(a.conversationId, a.id, a.conversationId, a.id) as { content: string; at: number } | undefined;
    return {
      id: a.id,
      conversationId: a.conversationId,
      fromId: a.fromId,
      toId: a.toId,
      question: a.content.replace(/^\[[^\]]* asks\]\s*/, ""),
      askedAt: a.at * 1000,
      answer: r?.content.trim() ?? null,
      answeredAt: r ? r.at * 1000 : null,
    };
  });
}
