import { db, sqlite } from "@/db";
import { economy } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listBuildings } from "./buildings";
import { tradeOf } from "./trades";

// The village's little economy (#106): pure bookkeeping, no model calls.
// Villagers make the goods by working their trade and eat when hungry
// (life.ts, #132); a farm or bakery nobody works still makes a little.
// Running short only dents morale; it never stops anyone working.

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
  // A new village starts with a small purse in the treasury (#136).
  const [made] = await db.insert(economy).values({ id: 1, treasury: 100, seeded: 1 }).returning();
  return made;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Once a day (the worker calls it in the daytime). Since village life (#132),
// villagers make the goods by working their trade and eat when they're
// hungry (life.ts); this only lets a farm or bakery that nobody works produce
// a little on its own, and starts the day's count of hungry moments afresh.
export async function dailyEconomy(now = new Date()): Promise<boolean> {
  const state = await getEconomy();
  if (state.lastTickDay === dayKey(now)) return false;
  const villagers = sqlite.prepare("SELECT role, trade, is_mayor AS isMayor FROM agents WHERE status = 'active'").all() as Array<{ role: string; trade: string | null; isMayor: number }>;
  const trades = new Set(villagers.map((v) => tradeOf({ trade: v.trade, role: v.role, isMayor: Boolean(v.isMayor) })));
  const built = (await listBuildings(now)).filter((b) => b.status === "built");
  const unworked = (kind: string, trade: string) => (trades.has(trade as never) ? [] : built.filter((b) => b.kind === kind).map(() => false));
  const next = economyTick(state, unworked("farm", "farmer"), unworked("bakery", "baker"), 0);
  await db.update(economy).set({ wheat: next.wheat, bread: next.bread, shortage: 0, lastTickDay: dayKey(now) }).where(eq(economy.id, 1));
  return true;
}

// Keepers walk to their building when they've nothing else on (VillageView).
export async function keeperDoors(): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  for (const b of await listBuildings()) if (b.status === "built" && b.keeperId) out[b.keeperId] = b.plotId;
  return out;
}
