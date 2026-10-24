import { NextResponse } from "next/server";
import { upcomingEvents } from "@/lib/agent/calendar";

export const dynamic = "force-dynamic";

// The owner's own calendar for the next two weeks (#108), for the wall
// calendar at home. Read-only; only the owner can reach this API.
export async function GET() {
  return NextResponse.json(await upcomingEvents());
}
