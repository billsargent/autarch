import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";

// Insert a message into a conversation without triggering an agent turn.
// Used by the UI to inject system events (e.g. file upload notifications).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversationId = Number(id);
  const convoRows = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!convoRows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const role = body.role === "event" || body.role === "user" ? (body.role as "event" | "user") : "event";
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  const inserted = await db
    .insert(messages)
    .values({ conversationId, role, content })
    .returning();
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
  return NextResponse.json({ message: inserted[0] });
}
