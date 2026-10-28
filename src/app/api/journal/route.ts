import { NextResponse } from "next/server";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getAgent } from "@/lib/agent/agents";

// ?agent=<id>: one villager's diary.
export async function GET(req: Request) {
  const agent = Number(new URL(req.url).searchParams.get("agent")) || null;
  const rows = await db
    .select()
    .from(journalEntries)
    .where(agent ? eq(journalEntries.agentId, agent) : undefined)
    .orderBy(desc(journalEntries.updatedAt))
    // The newest few hundred (#197): the diary grows with every work session.
    .limit(Math.min(1000, Number(new URL(req.url).searchParams.get("limit")) || 300));
  return NextResponse.json({ entries: rows });
}

export async function POST(req: Request) {
  const body = await req.json();
  const inserted = await db
    .insert(journalEntries)
    .values({
      title: String(body.title || "Human note"),
      body: body.body ? String(body.body) : null,
      category: (body.category as "exploration" | "task" | "reflection" | "idea" | "system") || "system",
      status: (body.status as "open" | "in_progress" | "done" | "abandoned") || "open",
      // A note in someone's diary (the Mayor's if not said).
      agentId: (await getAgent(Number(body.agentId) || null)).id,
    })
    .returning();
  return NextResponse.json({ entry: inserted[0] });
}
