import { NextResponse } from "next/server";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const unread = await db.select().from(notifications).where(eq(notifications.read, false)).orderBy(desc(notifications.createdAt)).limit(50);
  const recent = await db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(20);
  return NextResponse.json({ unread, recent });
}

export async function POST() {
  await db.update(notifications).set({ read: true }).where(eq(notifications.read, false));
  return NextResponse.json({ ok: true });
}
