import { NextResponse } from "next/server";
import { villageMorale } from "@/lib/agent/morale";

export const dynamic = "force-dynamic";

// How each villager is doing (#104).
export async function GET() {
  return NextResponse.json({ morale: await villageMorale() });
}
