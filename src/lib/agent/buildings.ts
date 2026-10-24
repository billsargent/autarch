import { db, sqlite } from "@/db";
import { buildings, notifications } from "@/db/schema";
import { and, eq, inArray, lte } from "drizzle-orm";
import { ensureMayor } from "./agents";
import type { AgentSettingsRow } from "./settingsStore";
import type { ToolContext } from "./tools";
import { MAX_VILLAGE_LEVEL, ringPlotIds } from "@/components/village/scenes/village";

// The village grows (#105, docs/town-charter.md section 9): the Mayor (or
// the owner) proposes a building on one of the empty plots north and west of
// town; the owner approves; it's scaffolding for a while, then it stands.
// Every house adds beds, and beds make room for more villagers.

// `morale`: what a finished one adds to everyone's morale (morale.ts).
export const BUILDING_KINDS = {
  house: { label: "House", beds: 2, stamp: "svHouseBlue", morale: 0 },
  farm: { label: "Farm", beds: 0, stamp: "wheatField", morale: 0 },
  bakery: { label: "Bakery", beds: 0, stamp: "fishShop", morale: 0 },
  workshop: { label: "Workshop", beds: 0, stamp: "stoneHouse", morale: 0 },
  tavern: { label: "Tavern", beds: 0, stamp: "greenMarket", morale: 5 },
  shop: { label: "Shop", beds: 0, stamp: "marketStall", morale: 3 },
  garden: { label: "Garden", beds: 0, stamp: "garden", morale: 3 },
} as const;
export type BuildingKind = keyof typeof BUILDING_KINDS;
export const isBuildingKind = (k: unknown): k is BuildingKind => typeof k === "string" && k in BUILDING_KINDS;

export const BUILD_HOURS = 12;
// Clearing a ring of new land (a "land" row, plot "ring-<n>") takes longer.
export const LAND_HOURS = 24;
export { MAX_VILLAGE_LEVEL };

// How far the village has grown: 0 is the first ring of land, and every
// cleared ring adds one, up to MAX_VILLAGE_LEVEL.
export function villageLevel(): number {
  const n = (sqlite.prepare("SELECT COUNT(*) AS n FROM buildings WHERE kind = 'land' AND status = 'built'").get() as { n: number }).n;
  return Math.min(MAX_VILLAGE_LEVEL, n);
}

// The plots there are at a level, inner ring first (scenes/village.ts).
export function plotsForLevel(level: number): string[] {
  return Array.from({ length: level + 1 }, (_, r) => ringPlotIds(r)).flat();
}

export type BuildingRow = typeof buildings.$inferSelect;

export class BuildingError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

// Buildings whose scaffolding time is up are finished.
function finishDue(now = new Date()) {
  db.update(buildings).set({ status: "built" }).where(and(eq(buildings.status, "building"), lte(buildings.readyAt, now))).run();
}

const current = (): BuildingRow[] => db.select().from(buildings).where(inArray(buildings.status, ["proposed", "building", "built"])).all();

export async function listBuildings(now = new Date()): Promise<BuildingRow[]> {
  finishDue(now);
  return current();
}

// Plots with nothing on them and nothing proposed.
function freePlots(): string[] {
  const taken = new Set(current().map((b) => b.plotId));
  return plotsForLevel(villageLevel()).filter((p) => !taken.has(p));
}

// Why the next ring of land can't be cleared yet (null = it can): every plot
// there is now must be spoken for first.
function landProblemNow(): string | null {
  const level = villageLevel();
  if (level >= MAX_VILLAGE_LEVEL) return "The village has all the land it can have.";
  const list = current();
  if (list.some((b) => b.kind === "land" && b.status !== "built")) return "New land is already being cleared, or waiting for the owner.";
  const taken = new Set(list.map((b) => b.plotId));
  const open = plotsForLevel(level).filter((p) => !taken.has(p));
  if (open.length) return `There's still room: build on ${open.join(", ")} first.`;
  return null;
}

export async function landProblem(): Promise<string | null> {
  finishDue();
  return landProblemNow();
}

// Clear the next ring of land: the owner's starts straight away, the Mayor's
// waits for the owner, like a building. Checked and written in one
// transaction, so two requests at once (the web app and the worker) can't
// both clear the same ring.
export async function proposeLand(by: number | null): Promise<BuildingRow> {
  finishDue();
  return sqlite
    .transaction(() => {
      const problem = landProblemNow();
      if (problem) throw new BuildingError(problem);
      const plotId = `ring-${villageLevel() + 1}`;
      return db
        .insert(buildings)
        .values(
          by === null
            ? { kind: "land", plotId, status: "building", proposedBy: null, readyAt: new Date(Date.now() + LAND_HOURS * 3600_000) }
            : { kind: "land", plotId, status: "proposed", proposedBy: by },
        )
        .returning()
        .get();
    })
    .immediate();
}

// Room for villagers: the setting, plus the beds in every finished house.
export function populationCap(settings: Pick<AgentSettingsRow, "maxPopulation">): number {
  const houses = (sqlite.prepare("SELECT COUNT(*) AS n FROM buildings WHERE kind = 'house' AND status = 'built'").get() as { n: number }).n;
  return settings.maxPopulation + houses * BUILDING_KINDS.house.beds;
}

// One transaction, like proposeLand, so a plot can't be taken twice.
export async function proposeBuilding(kind: BuildingKind, plotId: string | null, by: number | null): Promise<BuildingRow> {
  finishDue();
  return sqlite
    .transaction(() => {
      const free = freePlots();
      if (!free.length) throw new BuildingError("Every plot is taken.");
      const plot = plotId ?? free[0];
      const plots = plotsForLevel(villageLevel());
      if (!plots.includes(plot)) throw new BuildingError(`There's no plot called "${plot}". Plots: ${plots.join(", ")}.`, 400);
      if (!free.includes(plot)) throw new BuildingError(`The ${plot} plot is taken. Free: ${free.join(", ")}.`);
      // The owner builds straight away; the Mayor's proposals wait for the owner.
      return db
        .insert(buildings)
        .values(
          by === null
            ? { kind, plotId: plot, status: "building", proposedBy: null, readyAt: new Date(Date.now() + BUILD_HOURS * 3600_000) }
            : { kind, plotId: plot, status: "proposed", proposedBy: by },
        )
        .returning()
        .get();
    })
    .immediate();
}

export async function approveBuilding(id: number): Promise<BuildingRow> {
  const [b] = await db.select().from(buildings).where(eq(buildings.id, id));
  if (!b) throw new BuildingError("No such building.", 404);
  if (b.status !== "proposed") throw new BuildingError(`That building is already ${b.status}.`);
  const [row] = await db
    .update(buildings)
    .set({ status: "building", readyAt: new Date(Date.now() + (b.kind === "land" ? LAND_HOURS : BUILD_HOURS) * 3600_000) })
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
  if (kind === "land") {
    try {
      const row = await proposeLand(ctx?.agentId ?? null);
      const mayor = await ensureMayor();
      await db.insert(notifications).values({
        kind: "building",
        title: "The Mayor would like to clear new land",
        body: `${args.reason ? String(args.reason) : ""} Every plot is spoken for; clearing the next ring opens four more. Approve it at the map table in your home.`.trim(),
        severity: "info",
        source: mayor.name,
        agentId: mayor.id,
      });
      return { output: `Proposed clearing new land (${row.plotId}, #${row.id}). The owner decides at the map table.`, summary: "propose land" };
    } catch (err) {
      if (err instanceof BuildingError) return { output: `Refused: ${err.message.charAt(0).toLowerCase()}${err.message.slice(1)}`, summary: "land refused" };
      throw err;
    }
  }
  if (!isBuildingKind(kind)) return { output: `Refused: say what to build (\`kind\`: ${Object.keys(BUILDING_KINDS).join(", ")}, or land).`, summary: "building refused" };
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
