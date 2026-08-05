import { NextResponse } from "next/server";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const updated = await db
    .update(notifications)
    .set({ read: body.read !== false })
    .where(eq(notifications.id, Number(id)))
    .returning();
  return NextResponse.json({ notification: updated[0] });
}
