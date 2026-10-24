import { NextResponse } from "next/server";
import { promptDefaultsForDisplay } from "@/lib/agent/promptDefaults";
import { getSettings } from "@/lib/agent/settingsStore";

export const dynamic = "force-dynamic";

// The built-in prompts, for the Mayor's ledger → Prompts to show.
export async function GET() {
  return NextResponse.json(promptDefaultsForDisplay(await getSettings()));
}
