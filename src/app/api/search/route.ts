import { NextResponse } from "next/server";
import { getSettings } from "@/lib/agent/settingsStore";
import { webSearch } from "@/lib/agent/tools";

export const dynamic = "force-dynamic";

// "Try a search" in the Mayor's ledger (#170): one web_search as the
// villagers would see it, to check which engine answers.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 200) || "watermill";
  return NextResponse.json(await webSearch({ query: q, maxResults: 3 }, await getSettings()));
}
