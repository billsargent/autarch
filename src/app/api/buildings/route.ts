import { NextResponse } from "next/server";
import {
  BUILDING_KINDS,
  BuildingError,
  MAX_VILLAGE_LEVEL,
  isBuildingKind,
  landProblem,
  listBuildings,
  plotsForLevel,
  populationCap,
  proposeBuilding,
  proposeLand,
  villageLevel,
} from "@/lib/agent/buildings";
import { getEconomy, keeperDoors } from "@/lib/agent/economy";
import { getSettings } from "@/lib/agent/settingsStore";

export const dynamic = "force-dynamic";

// The plots and what stands on them (#105), the stores (#106), how many the
// village has room for, and how far its land reaches.
export async function GET() {
  const [list, stock, keepers, settings, landBlocked] = await Promise.all([listBuildings(), getEconomy(), keeperDoors(), getSettings(), landProblem()]);
  const level = villageLevel();
  return NextResponse.json({
    plots: plotsForLevel(level),
    kinds: BUILDING_KINDS,
    buildings: list,
    economy: stock,
    keepers,
    room: populationCap(settings),
    level,
    maxLevel: MAX_VILLAGE_LEVEL,
    landBlocked,
  });
}

// The owner builds on a plot, or clears new land (no approval needed: it
// starts straight away).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.kind !== "land" && !isBuildingKind(body.kind)) {
    return NextResponse.json({ error: `kind: must be ${Object.keys(BUILDING_KINDS).join(", ")} or land.` }, { status: 400 });
  }
  try {
    if (body.kind === "land") return NextResponse.json({ building: await proposeLand(null) });
    return NextResponse.json({ building: await proposeBuilding(body.kind, typeof body.plotId === "string" ? body.plotId : null, null) });
  } catch (err) {
    if (err instanceof BuildingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
