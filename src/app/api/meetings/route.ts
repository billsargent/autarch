import { NextResponse } from "next/server";
import { MeetingError, callMeeting, currentMeeting, meetingView, pastMeetings } from "@/lib/agent/meetings";

export const dynamic = "force-dynamic";

// The town meeting going on now, if any (#81).
export async function GET() {
  const m = await currentMeeting();
  return NextResponse.json(m ? await meetingView(m) : { meeting: null, past: await pastMeetings() });
}

// The owner calls a meeting (or joins the one already going).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const m = await callMeeting("owner", typeof body.topic === "string" ? body.topic : null);
    return NextResponse.json(await meetingView(m));
  } catch (err) {
    if (err instanceof MeetingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
