import { NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { asc } from "drizzle-orm";
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
  const inserted = await db
    .insert(jobs)
    .values({
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
