import { NextResponse } from "next/server";
import { letterThreads } from "@/lib/agent/letters";

export const dynamic = "force-dynamic";

// The letter rack at the post office (#172): every letter between villagers,
// by thread, newest first; `?agent=` keeps one villager's. Reading them here
// doesn't mark them read for the villager.
export async function GET(req: Request) {
  const agent = Number(new URL(req.url).searchParams.get("agent")) || undefined;
  return NextResponse.json({ threads: letterThreads(50, agent) });
}
