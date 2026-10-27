import { NextResponse } from "next/server";
import { neighbourTalk } from "@/lib/agent/messaging";

export const dynamic = "force-dynamic";

// What villagers have asked each other and how they answered (#57).
export async function GET() {
  return NextResponse.json({ exchanges: neighbourTalk(100) });
}
