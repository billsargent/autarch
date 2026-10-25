import { sqlite } from "@/db";
import { ORDER_DAYS, makeOrder, dayKey } from "./lifeRules";
import { logLife } from "./life";
import { GOOD_LABEL, isTradeKey, type Good } from "./trades";
import type { ToolContext } from "./tools";

// Orders from the neighbouring towns (#136). Each morning a town may ask for
// goods (no model calls); the Mayor or a trader accepts an order; once the
// village has the goods in stock they go out on the cart, the treasury is
// paid and the village's name grows. An accepted order that isn't filled in
// time costs some of that name.

export interface OrderRow {
  id: number;
  town: string;
  good: Good;
  qty: number;
  reward: number;
  status: "open" | "accepted" | "delivered" | "expired";
  acceptedBy: number | null;
  dueAt: number; // ms
  doneAt: number | null;
}

export const OPEN_ORDERS_MAX = 3;

export function listOrders(limit = 30): OrderRow[] {
  return sqlite
    .prepare(
      `SELECT id, town, good, qty, reward, status, accepted_by AS acceptedBy, due_at * 1000 AS dueAt, done_at * 1000 AS doneAt
       FROM trade_orders ORDER BY CASE status WHEN 'accepted' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, id DESC LIMIT ?`,
    )
    .all(limit) as OrderRow[];
}

// Once a day: overdue orders lapse, and a town may ask for something new.
export function dailyOrders(now = new Date(), rng: () => number = Math.random): boolean {
  const eco = sqlite.prepare("SELECT reputation, last_order_day AS day FROM economy WHERE id = 1").get() as { reputation: number; day: string | null } | undefined;
  if (!eco || eco.day === dayKey(now)) return false;
  const nowSec = Math.floor(now.getTime() / 1000);
  const tx = sqlite.transaction(() => {
    const lapsed = sqlite.prepare("SELECT id, town, status FROM trade_orders WHERE status IN ('open', 'accepted') AND due_at < ?").all(nowSec) as Array<{ id: number; town: string; status: string }>;
    for (const o of lapsed) {
      sqlite.prepare("UPDATE trade_orders SET status = 'expired', done_at = ? WHERE id = ?").run(nowSec, o.id);
      if (o.status === "accepted") {
        sqlite.prepare("UPDATE economy SET reputation = MAX(0, reputation - 1) WHERE id = 1").run();
        logLife("order", null, `The order for ${o.town} wasn't filled in time; they won't be pleased.`);
      }
    }
    const open = (sqlite.prepare("SELECT COUNT(*) AS n FROM trade_orders WHERE status = 'open'").get() as { n: number }).n;
    if (open < OPEN_ORDERS_MAX) {
      const o = makeOrder(eco.reputation, rng);
      sqlite.prepare("INSERT INTO trade_orders (town, good, qty, reward, due_at) VALUES (?, ?, ?, ?, ?)").run(o.town, o.good, o.qty, o.reward, nowSec + o.days * 86400);
      logLife("order", null, `${o.town} would like ${o.qty} ${GOOD_LABEL[o.good]} within ${ORDER_DAYS} days, for ${o.reward} coins.`);
    }
    sqlite.prepare("UPDATE economy SET last_order_day = ? WHERE id = 1").run(dayKey(now));
  });
  tx();
  return true;
}

// Accepted orders whose goods are in stock go out (inside the life tick, with
// its stock). Returns what was paid.
export function deliverOrders(stock: Partial<Record<Good, number>>, now = new Date()): number {
  let paid = 0;
  const accepted = sqlite.prepare("SELECT id, town, good, qty, reward FROM trade_orders WHERE status = 'accepted' ORDER BY id").all() as Array<{
    id: number;
    town: string;
    good: Good;
    qty: number;
    reward: number;
  }>;
  for (const o of accepted) {
    if ((stock[o.good] ?? 0) < o.qty) continue;
    stock[o.good] = (stock[o.good] ?? 0) - o.qty;
    paid += o.reward;
    sqlite.prepare("UPDATE trade_orders SET status = 'delivered', done_at = ? WHERE id = ?").run(Math.floor(now.getTime() / 1000), o.id);
    sqlite.prepare("UPDATE economy SET treasury = treasury + ?, reputation = MIN(20, reputation + 1) WHERE id = 1").run(o.reward);
    logLife("order", null, `The cart took ${o.qty} ${GOOD_LABEL[o.good]} to ${o.town}: ${o.reward} coins for the treasury.`);
  }
  return paid;
}

export class OrderError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

// `by`: the villager who took it on; null = the owner.
export function acceptOrder(id: number, by: number | null): OrderRow {
  const o = sqlite.prepare("SELECT status, town FROM trade_orders WHERE id = ?").get(id) as { status: string; town: string } | undefined;
  if (!o) throw new OrderError("No such order.", 404);
  if (o.status !== "open") throw new OrderError(`That order is already ${o.status}.`);
  sqlite.prepare("UPDATE trade_orders SET status = 'accepted', accepted_by = ? WHERE id = ?").run(by, id);
  const who = by ? (sqlite.prepare("SELECT name FROM agents WHERE id = ?").get(by) as { name: string } | undefined)?.name : null;
  logLife("order", by, `${who ?? "The owner"} took on ${o.town}'s order.`);
  return listOrders(100).find((r) => r.id === id)!;
}

// The accept_order tool: the Mayor (a power) or a trader in their own time.
export async function acceptOrderTool(args: Record<string, unknown>, ctx?: ToolContext) {
  if (!ctx?.agentId) return { output: "Refused: only a villager can take on an order.", summary: "order refused" };
  const me = sqlite.prepare("SELECT is_mayor AS isMayor, trade FROM agents WHERE id = ?").get(ctx.agentId) as { isMayor: number; trade: string | null } | undefined;
  if (!me?.isMayor && !(isTradeKey(me?.trade) && me?.trade === "trader")) return { output: "Refused: only the Mayor or a trader takes on orders.", summary: "order refused" };
  const open = listOrders(100).filter((o) => o.status === "open");
  const id = Number(args.order);
  if (!id) {
    return {
      output: open.length ? `Open orders: ${open.map((o) => `#${o.id} ${o.town}: ${o.qty} ${GOOD_LABEL[o.good]} for ${o.reward} coins`).join("; ")}. Say which with \`order\`.` : "There are no open orders right now.",
      summary: "orders listed",
    };
  }
  try {
    const o = acceptOrder(id, ctx.agentId);
    return { output: `Taken on: ${o.qty} ${GOOD_LABEL[o.good]} for ${o.town}. The cart goes as soon as the village has them in stock.`, summary: `accept order #${id}` };
  } catch (err) {
    if (err instanceof OrderError) return { output: `Refused: ${err.message}`, summary: "order refused" };
    throw err;
  }
}
