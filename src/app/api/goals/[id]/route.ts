import { NextResponse } from "next/server";
import { db } from "@/db";
import { goals } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const key of ["title", "body", "status", "priority"]) {
    if (key in body) patch[key] = body[key];
  }
  const updated = await db
    .update(goals)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(goals.id, Number(id)))
    .returning();
  return NextResponse.json({ goal: updated[0] });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(goals).where(eq(goals.id, Number(id)));
  return NextResponse.json({ ok: true });
}
