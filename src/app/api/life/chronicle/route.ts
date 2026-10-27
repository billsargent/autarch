import { NextResponse } from "next/server";
import { sqlite } from "@/db";

export const dynamic = "force-dynamic";

// The village chronicle (#132): what's happened in the villagers' lives,
// newest first. A theft or a doze shows only once someone noticed it (#153).
export async function GET() {
  const events = sqlite
    .prepare("SELECT id, kind, agent_id AS agentId, other_id AS otherId, text, created_at * 1000 AS at FROM life_events WHERE kind NOT IN ('theft', 'doze') ORDER BY id DESC LIMIT 80")
    .all();
  return NextResponse.json({ events });
}
