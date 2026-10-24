import { NextResponse } from "next/server";
import { awayActive, awayDecisions, awaySpent } from "@/lib/agent/away";
import { getSettings } from "@/lib/agent/settingsStore";

export const dynamic = "force-dynamic";

// Away mode at a glance (#102): whether the owner is away, what the village
// has spent since they left, and what the Mayor approved meanwhile.
export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    away: awayActive(settings),
    until: settings.awayUntil,
    since: settings.awayStartedAt,
    spent: awaySpent(settings),
    cap: settings.awaySpendCapUsd,
    decisions: awayDecisions(settings),
  });
}
