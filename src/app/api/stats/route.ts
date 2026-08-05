import { NextResponse } from "next/server";
import { db } from "@/db";
import { workSessions } from "@/db/schema";
import { desc, gte, ne, and, sql as dsql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const recent = await db.select().from(workSessions).orderBy(desc(workSessions.startedAt)).limit(50);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  // Aggregate in SQL over ALL of today's sessions, not just the most recent 50.
  const agg = await db
    .select({
      promptTokens: dsql<number>`coalesce(sum(${workSessions.promptTokens}),0)`,
      completionTokens: dsql<number>`coalesce(sum(${workSessions.completionTokens}),0)`,
      totalTokens: dsql<number>`coalesce(sum(${workSessions.totalTokens}),0)`,
      costUsd: dsql<number>`coalesce(sum(${workSessions.costUsd}),0)`,
      actionsUsed: dsql<number>`coalesce(sum(${workSessions.actionsUsed}),0)`,
      stepsUsed: dsql<number>`coalesce(sum(${workSessions.stepsUsed}),0)`,
      sessionCount: dsql<number>`count(*)`,
    })
    .from(workSessions)
    .where(and(gte(workSessions.startedAt, todayStart), ne(workSessions.status, "skipped")));
  const a = agg[0] ?? {};
  const totals = {
    promptTokens: Number(a.promptTokens ?? 0),
    completionTokens: Number(a.completionTokens ?? 0),
    totalTokens: Number(a.totalTokens ?? 0),
    costUsd: Number(a.costUsd ?? 0),
    actionsUsed: Number(a.actionsUsed ?? 0),
    stepsUsed: Number(a.stepsUsed ?? 0),
  };
  return NextResponse.json({ today: totals, todaySessionCount: Number(a.sessionCount ?? 0), recent });
}
