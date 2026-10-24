import { NextResponse } from "next/server";
import { listDrafts } from "@/lib/agent/drafts";

export const dynamic = "force-dynamic";

// The owner's outbox (#107).
export async function GET() {
  return NextResponse.json({ drafts: await listDrafts() });
}
