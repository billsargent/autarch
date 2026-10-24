import { db, sqlite } from "@/db";
import { economy } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listBuildings } from "./buildings";

// The village's little economy (#106): pure bookkeeping once a day, no model
// calls. Farms grow wheat, bakeries bake it into bread, everyone eats a loaf.
// A building with a keeper (a villager looking after it) does three times
// the work. Running short only dents morale; it never stops anyone working.

export interface Stock {
  wheat: number;
  bread: number;
}
export const YIELD = { kept: 6, unkept: 2 };
const MAX_STOCK = 99;

export function economyTick(stock: Stock, farms: boolean[], bakeries: boolean[], eaters: number): Stock & { shortage: number; grown: number; baked: number } {
  const grown = farms.reduce((n, kept) => n + (kept ? YIELD.kept : YIELD.unkept), 0);
  let wheat = stock.wheat + grown;
  const baked = Math.min(wheat, bakeries.reduce((n, kept) => n + (kept ? YIELD.kept : YIELD.unkept), 0));
  wheat -= baked;
  let bread = stock.bread + baked;
  const eaten = Math.min(bread, eaters);
  bread -= eaten;
  return { wheat: Math.min(MAX_STOCK, wheat), bread: Math.min(MAX_STOCK, bread), shortage: eaters - eaten, grown, baked };
}

export async function getEconomy() {
  const [row] = await db.select().from(economy).where(eq(economy.id, 1));
  if (row) return row;
  const [made] = await db.insert(economy).values({ id: 1 }).returning();
  return made;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Once a day (the worker calls it in the daytime): grow, bake, eat.
export async function dailyEconomy(now = new Date()): Promise<boolean> {
  const state = await getEconomy();
  if (state.lastTickDay === dayKey(now)) return false;
  const active = new Set((sqlite.prepare("SELECT id FROM agents WHERE status = 'active'").all() as Array<{ id: number }>).map((r) => r.id));
  const built = (await listBuildings(now)).filter((b) => b.status === "built");
  const kept = (kind: string) => built.filter((b) => b.kind === kind).map((b) => b.keeperId != null && active.has(b.keeperId));
  const next = economyTick(state, kept("farm"), kept("bakery"), active.size);
  await db
    .update(economy)
    .set({ wheat: next.wheat, bread: next.bread, shortage: next.shortage, lastTickDay: dayKey(now) })
    .where(eq(economy.id, 1));
  return true;
}

// Keepers walk to their building when they've nothing else on (VillageView).
export async function keeperDoors(): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  for (const b of await listBuildings()) if (b.status === "built" && b.keeperId) out[b.keeperId] = b.plotId;
  return out;
}
