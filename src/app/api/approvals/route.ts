import { NextResponse } from "next/server";
import { db } from "@/db";
import { toolExecutions } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const pending = await db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.status, "awaiting_approval"))
    .orderBy(desc(toolExecutions.requestedAt));
  const recentResolved = await db
    .select()
    .from(toolExecutions)
    .orderBy(desc(toolExecutions.requestedAt))
    .limit(30);
  return NextResponse.json({ pending, recent: recentResolved });
}
