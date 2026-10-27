import { sqlite } from "@/db";
import { BUILDING_KINDS, isBuildingKind, listBuildings } from "./buildings";
import { getEconomy } from "./economy";
import { listOrders } from "./orders";
import { GOOD_LABEL, GOODS, TRADES, tradeOf } from "./trades";

// THE VILLAGE TODAY (#151): the plain facts about the village, in every
// prompt, so the villagers don't fill the gaps from their notes or from each
// other. Read straight from the database; no model calls.

interface Villager {
  id: number;
  name: string;
  role: string;
  trade: string | null;
  isMayor: number;
  status: string;
}

// `mayor`: the Mayor also hears what neighbours noticed this week (#153).
export async function villageFacts(now = new Date(), mayor = false): Promise<string> {
  const villagers = sqlite
    .prepare("SELECT id, name, role, trade, is_mayor AS isMayor, status FROM agents WHERE status IN ('active', 'paused') ORDER BY is_mayor DESC, id")
    .all() as Villager[];
  if (!villagers.length) return "";
  const nameOf = new Map(villagers.map((v) => [v.id, v.name]));
  const tradeLabel = (v: Villager) => TRADES[tradeOf({ trade: v.trade, role: v.role, isMayor: Boolean(v.isMayor) })].label.toLowerCase();

  const buildings = (await listBuildings(now)).filter((b) => b.kind !== "land");
  const standing = buildings.filter((b) => b.status === "built");
  const label = (kind: string) => (isBuildingKind(kind) ? BUILDING_KINDS[kind].label.toLowerCase() : kind);
  // Who works a building: its keeper, and anyone whose trade works there.
  const workers = (kind: string, keeperId: number | null) => {
    const by = villagers.filter((v) => v.id === keeperId || TRADES[tradeOf({ trade: v.trade, role: v.role, isMayor: Boolean(v.isMayor) })].building === kind);
    return by.length ? ` (worked by ${by.map((v) => v.name).join(" and ")})` : " (nobody works it)";
  };
  const standingText = standing.map((b) => `${label(b.kind)}${workers(b.kind, b.keeperId)}`);
  const going = buildings.filter((b) => b.status === "building").map((b) => label(b.kind));
  const asked = buildings.filter((b) => b.status === "proposed").map((b) => label(b.kind));

  const stock = await getEconomy();
  const goods = GOODS.map((g) => `${stock[g] ?? 0} ${GOOD_LABEL[g]}`).join(", ");
  const orders = listOrders(10).filter((o) => o.status === "open" || o.status === "accepted");
  const orderText = orders.map(
    (o) => `${o.town} wants ${o.qty} ${GOOD_LABEL[o.good]} for ${o.reward} coins by ${new Date(o.dueAt).toDateString().slice(0, 10)} (${o.status === "accepted" ? `accepted${o.acceptedBy && nameOf.has(o.acceptedBy) ? ` by ${nameOf.get(o.acceptedBy)}` : ""}` : "nobody has taken it"})`,
  );
  const news = (sqlite.prepare("SELECT text FROM life_events WHERE kind IN ('order', 'level', 'wedding') ORDER BY id DESC LIMIT 3").all() as Array<{ text: string }>).map((r) => r.text);

  return [
    "THE VILLAGE TODAY (facts; these win over your notes, your memory or what a neighbour said)",
    `- Villagers: ${villagers.map((v) => `${v.name} (${v.isMayor ? "Mayor" : tradeLabel(v)}${v.status === "paused" ? ", resting" : ""})`).join(", ")}.`,
    `- Buildings standing: ${standingText.length ? standingText.join(", ") : "none of the trade buildings yet"}. Also the town hall, the library, the notice board, the storehouse and the post office.`,
    going.length ? `- Being built: ${going.join(", ")}.` : "",
    asked.length ? `- Waiting for the owner's approval: ${asked.join(", ")}.` : "",
    `- In the stores: ${goods}. Treasury: ${stock.treasury} coins.`,
    `- Orders from other towns: ${orderText.length ? orderText.join("; ") : "none open"}.`,
    news.length ? `- Lately: ${news.join(" ")}` : "",
    mayor ? conductLine(now) : "",
    "- If something isn't listed here, the village doesn't have it. Don't invent prices, dates, harvests, suppliers or trade the village doesn't have; say you don't know.",
  ]
    .filter(Boolean)
    .join("\n");
}

// What neighbours noticed this week (#153), for the Mayor: who, and how often.
function conductLine(now: Date): string {
  const since = Math.floor(now.getTime() / 1000) - 7 * 86400;
  const rows = sqlite
    .prepare("SELECT a.name AS name, e.kind AS kind FROM life_events e JOIN agents a ON a.id = e.agent_id WHERE e.kind IN ('seen_theft', 'seen_doze') AND e.created_at >= ? AND a.status != 'dismissed'")
    .all(since) as Array<{ name: string; kind: string }>;
  if (!rows.length) return "";
  const count = new Map<string, { theft: number; doze: number }>();
  for (const r of rows) {
    const c = count.get(r.name) ?? { theft: 0, doze: 0 };
    if (r.kind === "seen_theft") c.theft++;
    else c.doze++;
    count.set(r.name, c);
  }
  const parts = [...count.entries()].map(([name, c]) => [c.theft && `${name} was seen taking loaves ${c.theft} time${c.theft > 1 ? "s" : ""}`, c.doze && `${name} was caught dozing ${c.doze} time${c.doze > 1 ? "s" : ""}`].filter(Boolean).join(", "));
  return `- Noticed this week: ${parts.join("; ")}. If it keeps happening, a conduct vote (call_conduct_vote) lets the village decide.`;
}
