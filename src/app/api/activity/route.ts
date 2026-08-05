import { NextResponse } from "next/server";
import { db } from "@/db";
import { toolExecutions } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") || 100));
  const rows = await db.select().from(toolExecutions).orderBy(desc(toolExecutions.requestedAt)).limit(limit);
  return NextResponse.json({ executions: rows });
}
