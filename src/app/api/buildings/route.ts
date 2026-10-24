import { NextResponse } from "next/server";
import { BUILDING_KINDS, BuildingError, PLOT_IDS, isBuildingKind, listBuildings, populationCap, proposeBuilding } from "@/lib/agent/buildings";
import { getEconomy, keeperDoors } from "@/lib/agent/economy";
import { getSettings } from "@/lib/agent/settingsStore";

export const dynamic = "force-dynamic";

// The plots and what stands on them (#105), the stores (#106), and how many
// the village has room for.
export async function GET() {
  const [list, stock, keepers, settings] = await Promise.all([listBuildings(), getEconomy(), keeperDoors(), getSettings()]);
  return NextResponse.json({ plots: PLOT_IDS, kinds: BUILDING_KINDS, buildings: list, economy: stock, keepers, room: populationCap(settings) });
}

// The owner builds on a plot (no approval needed: it starts straight away).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!isBuildingKind(body.kind)) return NextResponse.json({ error: "kind: must be house, farm, bakery or workshop." }, { status: 400 });
  try {
    return NextResponse.json({ building: await proposeBuilding(body.kind, typeof body.plotId === "string" ? body.plotId : null, null) });
  } catch (err) {
    if (err instanceof BuildingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
