import { db, sqlite } from "@/db";
import { buildings, notifications } from "@/db/schema";
import { and, eq, inArray, lte } from "drizzle-orm";
import { ensureMayor } from "./agents";
import type { AgentSettingsRow } from "./settingsStore";
import type { ToolContext } from "./tools";

// The village grows (#105, docs/town-charter.md section 9): the Mayor (or
// the owner) proposes a building on one of the empty plots north and west of
// town; the owner approves; it's scaffolding for a while, then it stands.
// Every house adds beds, and beds make room for more villagers.

export const BUILDING_KINDS = {
  house: { label: "House", beds: 2, stamp: "svHouseBlue" },
  farm: { label: "Farm", beds: 0, stamp: "wheatField" },
  bakery: { label: "Bakery", beds: 0, stamp: "fishShop" },
  workshop: { label: "Workshop", beds: 0, stamp: "stoneHouse" },
} as const;
export type BuildingKind = keyof typeof BUILDING_KINDS;
export const isBuildingKind = (k: unknown): k is BuildingKind => typeof k === "string" && k in BUILDING_KINDS;

// The village's plots, by id (scenes/village.ts).
export const PLOT_IDS = ["north-1", "north-2", "west-1", "west-2"];
export const BUILD_HOURS = 12;

export type BuildingRow = typeof buildings.$inferSelect;

export class BuildingError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

// Buildings whose scaffolding time is up are finished.
async function finishDue(now = new Date()) {
  await db.update(buildings).set({ status: "built" }).where(and(eq(buildings.status, "building"), lte(buildings.readyAt, now)));
}

export async function listBuildings(now = new Date()): Promise<BuildingRow[]> {
  await finishDue(now);
  return db.select().from(buildings).where(inArray(buildings.status, ["proposed", "building", "built"]));
}

// Plots with nothing on them and nothing proposed.
async function freePlots(): Promise<string[]> {
  const taken = new Set((await listBuildings()).map((b) => b.plotId));
  return PLOT_IDS.filter((p) => !taken.has(p));
}

// Room for villagers: the setting, plus the beds in every finished house.
export function populationCap(settings: Pick<AgentSettingsRow, "maxPopulation">): number {
  const houses = (sqlite.prepare("SELECT COUNT(*) AS n FROM buildings WHERE kind = 'house' AND status = 'built'").get() as { n: number }).n;
  return settings.maxPopulation + houses * BUILDING_KINDS.house.beds;
}

export async function proposeBuilding(kind: BuildingKind, plotId: string | null, by: number | null): Promise<BuildingRow> {
  const free = await freePlots();
  if (!free.length) throw new BuildingError("Every plot is taken.");
  const plot = plotId ?? free[0];
  if (!PLOT_IDS.includes(plot)) throw new BuildingError(`There's no plot called "${plot}". Plots: ${PLOT_IDS.join(", ")}.`, 400);
  if (!free.includes(plot)) throw new BuildingError(`The ${plot} plot is taken. Free: ${free.join(", ")}.`);
  // The owner builds straight away; the Mayor's proposals wait for the owner.
  const [row] = await db
    .insert(buildings)
    .values(
      by === null
        ? { kind, plotId: plot, status: "building", proposedBy: null, readyAt: new Date(Date.now() + BUILD_HOURS * 3600_000) }
        : { kind, plotId: plot, status: "proposed", proposedBy: by },
    )
    .returning();
  return row;
}

export async function approveBuilding(id: number): Promise<BuildingRow> {
  const [b] = await db.select().from(buildings).where(eq(buildings.id, id));
  if (!b) throw new BuildingError("No such building.", 404);
  if (b.status !== "proposed") throw new BuildingError(`That building is already ${b.status}.`);
  const [row] = await db
    .update(buildings)
    .set({ status: "building", readyAt: new Date(Date.now() + BUILD_HOURS * 3600_000) })
    .where(eq(buildings.id, id))
    .returning();
  return row;
}

export async function declineBuilding(id: number) {
  const [b] = await db.select().from(buildings).where(eq(buildings.id, id));
  if (!b) throw new BuildingError("No such building.", 404);
  if (b.status !== "proposed") throw new BuildingError(`That building is already ${b.status}.`);
  await db.update(buildings).set({ status: "declined" }).where(eq(buildings.id, id));
}

// Who looks after a farm or a bakery (#106); null = nobody.
export async function setKeeper(id: number, agentId: number | null) {
  const [b] = await db.select().from(buildings).where(eq(buildings.id, id));
  if (!b) throw new BuildingError("No such building.", 404);
  await db.update(buildings).set({ keeperId: agentId }).where(eq(buildings.id, id));
}

// The Mayor's propose_building tool.
export async function proposeBuildingTool(args: Record<string, unknown>, ctx?: ToolContext) {
  const kind = args.kind;
  if (!isBuildingKind(kind)) return { output: `Refused: say what to build (\`kind\`: ${Object.keys(BUILDING_KINDS).join(", ")}).`, summary: "building refused" };
  try {
    const row = await proposeBuilding(kind, args.plot ? String(args.plot) : null, ctx?.agentId ?? null);
    const mayor = await ensureMayor();
    await db.insert(notifications).values({
      kind: "building",
      title: `The Mayor would like to build a ${BUILDING_KINDS[kind].label.toLowerCase()}`,
      body: `${args.reason ? String(args.reason) : ""} On the ${row.plotId} plot. Approve it at the map table in your home.`.trim(),
      severity: "info",
      source: mayor.name,
      agentId: mayor.id,
    });
    return { output: `Proposed a ${kind} on the ${row.plotId} plot (#${row.id}). The owner decides at the map table.`, summary: `propose ${kind}` };
  } catch (err) {
    if (err instanceof BuildingError) return { output: `Refused: ${err.message.charAt(0).toLowerCase()}${err.message.slice(1)}`, summary: "building refused" };
    throw err;
  }
}
