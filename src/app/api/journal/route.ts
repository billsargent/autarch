import { NextResponse } from "next/server";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(journalEntries).orderBy(desc(journalEntries.updatedAt));
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
    })
    .returning();
  return NextResponse.json({ entry: inserted[0] });
}
