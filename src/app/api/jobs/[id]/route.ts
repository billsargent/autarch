import { NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cronProblem, nextCronRun } from "@/lib/agent/cron";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "instruction", "kind", "enabled"]) {
    if (key in body) patch[key] = body[key];
  }
  // conversationId comes from a <select> as a string; normalize to number or null.
  // Guard against stale FK references (conversation was deleted without cascade).
  if ("conversationId" in body) {
    const raw = body.conversationId;
    const num = raw === "" || raw === null || raw === undefined ? null : Number(raw);
    if (num !== null && Number.isFinite(num)) {
      // Verify the conversation still exists before applying the FK.
      const conv = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, num)).limit(1);
      patch.conversationId = conv.length ? num : null;
    } else {
      patch.conversationId = null;
    }
  }
  if ("intervalMinutes" in body) patch.intervalMinutes = Math.max(5, Number(body.intervalMinutes) || 60);
  if ("maxDurationMinutes" in body) patch.maxDurationMinutes = Math.max(1, Number(body.maxDurationMinutes) || 10);
  if ("reportSessionTitle" in body) {
    const t = typeof body.reportSessionTitle === "string" ? body.reportSessionTitle.trim() : "";
    patch.reportSessionTitle = t || null;
  }
  if ("cron" in body) {
    const c = typeof body.cron === "string" ? body.cron.trim() : "";
    const problem = c ? cronProblem(c) : null;
    if (problem) return NextResponse.json({ error: `That cron schedule won't work: ${problem}.` }, { status: 400 });
    patch.cron = c || null;
  }
  // Re-plan the next run when the job is switched on or its schedule changes;
  // otherwise a new cron would wait for the old schedule's time.
  const [row] = await db.select().from(jobs).where(eq(jobs.id, Number(id))).limit(1);
  const scheduleChanged =
    ("cron" in patch && patch.cron !== (row?.cron ?? null)) ||
    ("intervalMinutes" in patch && patch.intervalMinutes !== row?.intervalMinutes);
  if (patch.enabled === true || scheduleChanged) {
    const rawCron = "cron" in patch ? ((patch.cron as string | null) ?? "") : (row?.cron ?? "");
    const cron = rawCron.trim();
    // Use the new intervalMinutes if it was patched, otherwise the existing DB value.
    const interval = ((patch.intervalMinutes as number | undefined) ?? Number(row?.intervalMinutes)) || 60;
    patch.nextRunAt = cron ? nextCronRun(cron, new Date()) ?? new Date(Date.now() + interval * 60_000) : new Date(Date.now() + interval * 60_000);
  }
  const updated = await db
    .update(jobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(jobs.id, Number(id)))
    .returning();
  return NextResponse.json({ job: updated[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(jobs).where(eq(jobs.id, Number(id)));
  return NextResponse.json({ ok: true });
}
