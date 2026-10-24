import { NextResponse } from "next/server";
import { listHireRequests } from "@/lib/agent/hiring";

export const dynamic = "force-dynamic";

// Hire requests (#99): waiting ones first, then recent decisions.
export async function GET() {
  return NextResponse.json({ requests: await listHireRequests() });
}
