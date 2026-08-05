import { NextResponse } from "next/server";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const key of ["title", "body", "category", "status"]) {
    if (key in body) patch[key] = body[key];
  }
  const updated = await db
    .update(journalEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(journalEntries.id, Number(id)))
    .returning();
  return NextResponse.json({ entry: updated[0] });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(journalEntries).where(eq(journalEntries.id, Number(id)));
  return NextResponse.json({ ok: true });
}
