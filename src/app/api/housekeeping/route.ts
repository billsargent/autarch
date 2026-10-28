import { NextResponse } from "next/server";
import { lastTidy, tidyUp } from "@/lib/agent/housekeeping";
import { getSettings } from "@/lib/agent/settingsStore";

export const dynamic = "force-dynamic";

// Housekeeping (#197): when it last ran and what it let go, and "Tidy up now".
export async function GET() {
  return NextResponse.json({ last: lastTidy() });
}

export async function POST() {
  return NextResponse.json({ last: tidyUp((await getSettings()).historyDays) });
}
