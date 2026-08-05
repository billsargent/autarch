import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, workSessions } from "@/db/schema";
import { desc, eq, sql as dsql } from "drizzle-orm";
import { ensureConversation } from "@/lib/agent/runner";

export async function GET() {
  const rows = await db.select().from(conversations).orderBy(desc(conversations.updatedAt));
  // Which conversations have a turn actively running right now.
  const active = await db
    .select({ conversationId: workSessions.conversationId })
    .from(workSessions)
    .where(eq(workSessions.status, "running"));
  const runningIds = new Set(active.map((a) => a.conversationId).filter((x): x is number => x != null));
  // Latest message id per conversation, used for unread badges.
  const lastMsg = await db
    .select({ conversationId: messages.conversationId, lastId: dsql<number>`max(${messages.id})` })
    .from(messages)
    .groupBy(messages.conversationId);
  const lastById = new Map(lastMsg.map((m) => [m.conversationId, m.lastId] as const));
  const withMeta = rows.map((c) => ({
    ...c,
    running: runningIds.has(c.id),
    lastMessageId: lastById.get(c.id) ?? 0,
  }));
  return NextResponse.json({ conversations: withMeta });
}

export async function POST() {
  const convo = await ensureConversation(null);
  return NextResponse.json({ conversation: convo });
}
