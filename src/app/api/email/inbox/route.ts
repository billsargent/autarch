import { NextResponse } from "next/server";
import { readInbox } from "@/lib/agent/email";

export const dynamic = "force-dynamic";

// The owner's inbox at the post office (#144): the newest messages, read-only.
export async function GET() {
  try {
    return NextResponse.json(await readInbox({ limit: 20 }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) });
  }
}
