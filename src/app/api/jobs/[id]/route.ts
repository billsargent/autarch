import { NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nextCronRun } from "@/lib/agent/cron";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "instruction", "kind", "enabled"]) {
    if (key in body) patch[key] = body[key];
  }
  if ("intervalMinutes" in body) patch.intervalMinutes = Math.max(5, Number(body.intervalMinutes) || 60);
  if ("maxDurationMinutes" in body) patch.maxDurationMinutes = Math.max(1, Number(body.maxDurationMinutes) || 10);
  if ("cron" in body) {
    const c = typeof body.cron === "string" ? body.cron.trim() : "";
    patch.cron = c || null;
  }
  if (patch.enabled === true) {
    const row = await db.select().from(jobs).where(eq(jobs.id, Number(id))).limit(1);
    const cron = String(patch.cron ?? row[0]?.cron ?? "").trim();
    const interval = Number(row[0]?.intervalMinutes) || 60;
    patch.nextRunAt = cron ? nextCronRun(cron, new Date()) ?? new Date(Date.now() + interval * 60_000) : new Date(Date.now() + interval * 60_000);
  }
  const updated = await db
    .update(jobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(jobs.id, Number(id)))
    .returning();
  return NextResponse.json({ job: updated[0] });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(jobs).where(eq(jobs.id, Number(id)));
  return NextResponse.json({ ok: true });
}
