import { NextResponse } from "next/server";
import { db } from "@/db";
import { goals } from "@/db/schema";
import { asc, desc } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(goals).orderBy(asc(goals.priority), desc(goals.updatedAt));
  return NextResponse.json({ goals: rows });
}

export async function POST(req: Request) {
  const body = await req.json();
  const inserted = await db
    .insert(goals)
    .values({
      title: String(body.title || "Untitled goal"),
      body: body.body ? String(body.body) : null,
      status: (body.status as "backlog" | "in_progress" | "done" | "abandoned") || "backlog",
      priority: Number(body.priority) || 3,
      conversationId: body.conversationId ? Number(body.conversationId) : null,
      // A villager's own goal, or (empty) a town goal anyone may pick up.
      agentId: body.agentId ? Number(body.agentId) : null,
    })
    .returning();
  return NextResponse.json({ goal: inserted[0] });
}
