import { NextResponse } from "next/server";
import { GoogleError, disconnectGoogle, getCalendarSettings, googleConnected, listCalendars, publicCalendar, saveCalendarSettings } from "@/lib/agent/google";
import { redirectUri } from "./redirect";

export const dynamic = "force-dynamic";

// The owner's Google Calendar connection (#142). The client secret and the
// tokens are write-only: never sent back, only whether they're set.
export async function GET(req: Request) {
  const c = await getCalendarSettings();
  const calendars = googleConnected(c) ? await listCalendars().catch(() => []) : [];
  return NextResponse.json({ ...publicCalendar(c, redirectUri(req)), calendars });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send the settings as JSON." }, { status: 400 });
  try {
    await saveCalendarSettings(body);
    return GET(req);
  } catch (err) {
    if (err instanceof GoogleError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

// Disconnect: the sign-in is revoked at Google and forgotten here.
export async function DELETE(req: Request) {
  await disconnectGoogle();
  return GET(req);
}
