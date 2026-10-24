import { NextResponse } from "next/server";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { MeetingError, askMeeting, closeMeeting, meetingView } from "@/lib/agent/meetings";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, Number((await params).id)));
  if (!m) return NextResponse.json({ error: "No such meeting." }, { status: 404 });
  return NextResponse.json(await meetingView(m));
}

// The owner asks the meeting something ({ action: "ask", message }) or ends
// it ({ action: "close" }).
export async function PATCH(req: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "close") {
      await closeMeeting(id);
      return NextResponse.json({ meeting: null });
    } else if (body.action === "ask") await askMeeting(id, String(body.message ?? ""));
    else return NextResponse.json({ error: "action: must be ask or close." }, { status: 400 });
  } catch (err) {
    if (err instanceof MeetingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
  return NextResponse.json(await meetingView(m));
}
