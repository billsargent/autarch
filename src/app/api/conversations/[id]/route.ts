import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, toolExecutions, workSessions } from "@/db/schema";
import { asc, desc, eq, and, gt, lt, count } from "drizzle-orm";
import { CHAT_MODES, isChatMode } from "@/lib/agent/chatMode";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversationId = Number(id);
  const convoRows = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!convoRows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const before = url.searchParams.get("before") ? Number(url.searchParams.get("before")) : null;
  const since = url.searchParams.get("since") ? Number(url.searchParams.get("since")) : null;

  // Messages: supports `since` (poll for newer), `before` (scroll up for older),
  // or neither (latest chunk). Always returned in ascending id order for display.
  let msgRows: typeof messages.$inferSelect[] = [];
  let hasMore = false;
  if (since != null && Number.isFinite(since)) {
    msgRows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), gt(messages.id, since)))
      .orderBy(asc(messages.id))
      .limit(limit);
  } else {
    const refId = before != null && Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER;
    msgRows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), lt(messages.id, refId)))
      .orderBy(desc(messages.id))
      .limit(limit);
    msgRows.reverse();
    // Are there older messages beyond this chunk? (only relevant for scroll-up)
    if (msgRows.length) {
      const oldest = msgRows[0].id;
      const older = await db
        .select({ n: count() })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), lt(messages.id, oldest)));
      hasMore = Number(older[0]?.n ?? 0) > 0;
    }
  }

  const execRows = await db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.conversationId, conversationId))
    .orderBy(desc(toolExecutions.id))
    .limit(50);
  execRows.reverse();

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
    hasMore,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Partial<typeof conversations.$inferInsert> = {};
  if ("title" in body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
    // Renaming bumps updatedAt (sidebar order); a mode switch alone does not.
    patch.title = title.slice(0, 200);
    patch.updatedAt = new Date();
  }
  if ("chatMode" in body) {
    if (!isChatMode(body.chatMode)) {
      return NextResponse.json({ error: `chatMode must be one of: ${CHAT_MODES.join(", ")}` }, { status: 400 });
    }
    patch.chatMode = body.chatMode;
  }
  // This conversation's own provider and model (#64); null = its villager's.
  if ("providerId" in body) patch.providerId = typeof body.providerId === "number" && body.providerId > 0 ? body.providerId : null;
  if ("model" in body) patch.model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 200) : null;
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "title, chatMode, providerId or model is required" }, { status: 400 });
  }
  const updated = await db
    .update(conversations)
    .set(patch)
    .where(eq(conversations.id, Number(id)))
    .returning();
  return updated.length ? NextResponse.json({ conversation: updated[0] }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(conversations).where(eq(conversations.id, Number(id)));
  return NextResponse.json({ ok: true });
}
