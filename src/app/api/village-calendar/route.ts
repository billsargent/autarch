import { NextResponse } from "next/server";
import { getCalendarSettings, googleConnected } from "@/lib/agent/google";
import { CalendarError, addEvent, cancelEvent, upcoming } from "@/lib/agent/villageCalendar";
import { sqlite } from "@/db";

export const dynamic = "force-dynamic";

// The village calendar (#173), for the owner: what's coming up, adding an
// event, and taking one off.
export async function GET(req: Request) {
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days")) || 30, 1), 120);
  const events = upcoming(days);
  const c = await getCalendarSettings();
  const errors = sqlite.prepare("SELECT COUNT(*) AS n FROM village_events WHERE sync_error IS NOT NULL AND cancelled = 0").get() as { n: number };
  return NextResponse.json({
    events,
    copiedTo: googleConnected(c) && c.villageCalendarId ? c.villageCalendarName || "your Google calendar" : null,
    syncProblems: errors.n,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ event: addEvent(body, { source: "owner" }) });
  } catch (err) {
    if (err instanceof CalendarError) return NextResponse.json({ error: err.message.replace(/^./, (c) => c.toUpperCase()) }, { status: err.status });
    throw err;
  }
}

// { id, action: "cancel" }
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: number; action?: string };
  if (body.action !== "cancel" || !Number.isInteger(body.id)) return NextResponse.json({ error: "action: cancel, with the event's id." }, { status: 400 });
  try {
    cancelEvent(body.id!);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CalendarError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
