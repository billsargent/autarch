import { NextResponse } from "next/server";
import { db } from "@/db";
import { workSessions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = await db
    .select()
    .from(workSessions)
    .where(eq(workSessions.jobId, Number(id)))
    .orderBy(desc(workSessions.startedAt))
    .limit(50);
  return NextResponse.json({ runs });
}
