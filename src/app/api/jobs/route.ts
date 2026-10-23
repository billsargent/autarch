import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, jobs } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { nextCronRun } from "@/lib/agent/cron";

export async function GET() {
  const rows = await db.select().from(jobs).orderBy(asc(jobs.nextRunAt));
  return NextResponse.json({ jobs: rows });
}

export async function POST(req: Request) {
  try {
  const body = await req.json();
  const intervalMinutes = Math.max(5, Number(body.intervalMinutes) || 60);
  const maxDurationMinutes = Math.max(1, Number(body.maxDurationMinutes) || 10);
  const cron = typeof body.cron === "string" && body.cron.trim() ? body.cron.trim() : "";
  const nextRunAt = cron
    ? nextCronRun(cron, new Date()) ?? new Date(Date.now() + intervalMinutes * 60_000)
    : new Date(Date.now() + intervalMinutes * 60_000);
  // The conversation reports go to; unknown ids fall back to auto-creating one.
  const convNum = body.conversationId === "" || body.conversationId == null ? null : Number(body.conversationId);
  const conversationId =
    convNum !== null && Number.isFinite(convNum) &&
    (await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, convNum)).limit(1)).length
      ? convNum
      : null;
  const inserted = await db
    .insert(jobs)
    .values({
      conversationId,
      name: String(body.name || "Untitled job"),
      instruction: body.instruction ? String(body.instruction) : "",
      kind: body.kind === "daily_report" ? "daily_report" : "interval",
      intervalMinutes,
      maxDurationMinutes,
      reportSessionTitle: body.reportSessionTitle ? String(body.reportSessionTitle).trim() || null : null,
      cron: cron || null,
      enabled: body.enabled !== false,
      nextRunAt,
    })
    .returning();
  return NextResponse.json({ job: inserted[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
