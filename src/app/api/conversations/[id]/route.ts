import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, toolExecutions, workSessions } from "@/db/schema";
import { asc, eq, and } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversationId = Number(id);
  const convoRows = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!convoRows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const msgRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.id));
  const execRows = await db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.conversationId, conversationId))
    .orderBy(asc(toolExecutions.id));
  const activeSession = await db
    .select({ id: workSessions.id, stepsUsed: workSessions.stepsUsed, startedAt: workSessions.startedAt })
    .from(workSessions)
    .where(and(eq(workSessions.conversationId, conversationId), eq(workSessions.status, "running")))
    .limit(1);
  const running = activeSession.length > 0;
  return NextResponse.json({
    conversation: convoRows[0],
    messages: msgRows,
    executions: execRows,
    running,
    activeSession: running ? activeSession[0] : null,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const updated = await db
    .update(conversations)
    .set({ title: title.slice(0, 200), updatedAt: new Date() })
    .where(eq(conversations.id, Number(id)))
    .returning();
  return updated.length ? NextResponse.json({ conversation: updated[0] }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(conversations).where(eq(conversations.id, Number(id)));
  return NextResponse.json({ ok: true });
}
