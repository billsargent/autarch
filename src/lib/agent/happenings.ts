import { sqlite } from "@/db";
import { logLife } from "./life";
import { GOOD_PRICE, makeOrder, ORDER_DAYS } from "./lifeRules";
import { SEASON_NOTE, seasonOf, villageDayStart, type Season } from "./seasons";
import { GOOD_LABEL, GOODS, type Good } from "./trades";
import { addEvent, ensureCalendarTables } from "./villageCalendar";
import type { VillageClock } from "./villageClock";

// The village's happenings (#187): once each village day, chance has its say.
// No model calls; each is written in the chronicle and shown in THE VILLAGE
// TODAY while it lasts (that village day).
// - A storm: some wheat spoils, and the fields are slow for the day.
// - A travelling merchant: buys what the village has plenty of, for the
//   treasury, and sells iron to a village with a smithy (#188).
// - A fair in a neighbouring town: two more orders.
// The turn of the seasons is marked too, and when autumn comes the harvest
// festival goes on the village calendar for its fourth day.

export type HappeningKind = "storm" | "merchant" | "fair";
export const CHANCE: Record<HappeningKind, (s: Season) => number> = {
  storm: (s) => (s === "autumn" ? 0.12 : s === "winter" ? 0.08 : 0.06),
  merchant: () => 0.15,
  fair: (s) => (s === "summer" || s === "autumn" ? 0.1 : 0.06),
};
export const MERCHANT_IRON = { qty: 6, price: 3 };
const SURPLUS_AT = 12; // the merchant buys goods the stores have more than this of
const MERCHANT_BUYS = 5; // of each

export function ensureHappeningTables() {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS happenings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    day INTEGER NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS village_seasons (
    id INTEGER PRIMARY KEY,
    day INTEGER,
    season TEXT
  )`);
}

// What's happening on a village day.
export function happeningsOn(day: number): Array<{ kind: HappeningKind; note: string }> {
  ensureHappeningTables();
  return sqlite.prepare("SELECT kind, note FROM happenings WHERE day = ? ORDER BY id").all(day) as Array<{ kind: HappeningKind; note: string }>;
}

const built = (kind: string) => Boolean(sqlite.prepare("SELECT 1 FROM buildings WHERE kind = ? AND status = 'built'").get(kind));
const stockOf = () => sqlite.prepare("SELECT * FROM economy WHERE id = 1").get() as Record<string, number> | undefined;

// The day's roll, once per village day. Returns what happened (empty when
// the day was already rolled or nothing happened).
export function dailyHappenings(now: Date, clock: VillageClock, dayHours: number, rng: () => number = Math.random): HappeningKind[] {
  ensureHappeningTables();
  const s = seasonOf(now, clock, dayHours);
  const last = sqlite.prepare("SELECT day, season FROM village_seasons WHERE id = 1").get() as { day: number | null; season: string | null } | undefined;
  if (last?.day === s.dayNumber) return [];
  sqlite.prepare("INSERT INTO village_seasons (id, day, season) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET day = excluded.day, season = excluded.season").run(s.dayNumber, s.season);

  // A new season (not on the very first roll: an old village just learning of seasons).
  if (last?.season && last.season !== s.season) {
    logLife("season", null, `${s.season[0].toUpperCase()}${s.season.slice(1)} has come to the village: ${SEASON_NOTE[s.season].split(": ")[1]}.`);
    if (s.season === "autumn") harvestFestival(s.startedOn + 3, clock, dayHours);
  }
  wearTools();

  const eco = stockOf();
  if (!eco) return [];
  const happened: HappeningKind[] = [];
  const note = (kind: HappeningKind, text: string) => {
    sqlite.prepare("INSERT INTO happenings (kind, day, note) VALUES (?, ?, ?)").run(kind, s.dayNumber, text);
    logLife("happening", null, text);
    happened.push(kind);
  };

  if (rng() < CHANCE.storm(s.season)) {
    const spoiled = Math.floor((eco.wheat ?? 0) * 0.3);
    if (spoiled) sqlite.prepare("UPDATE economy SET wheat = MAX(0, wheat - ?) WHERE id = 1").run(spoiled);
    note("storm", `A storm swept through${spoiled ? ` and spoiled ${spoiled} wheat in the stores` : ""}. The fields will be slow today.`);
  }

  // The merchant comes more often when the smithy is out of iron.
  const smithy = built("smithy");
  const wantsIron = smithy && (eco.iron ?? 0) < MERCHANT_IRON.qty;
  if (rng() < CHANCE.merchant(s.season) + (wantsIron ? 0.1 : 0)) {
    const sold: string[] = [];
    let earned = 0;
    for (const g of GOODS.filter((x): x is Good => !["iron", "tools", "wheat", "flour", "bread"].includes(x))) {
      if ((eco[g] ?? 0) > SURPLUS_AT) {
        sqlite.prepare(`UPDATE economy SET ${g} = ${g} - ? WHERE id = 1`).run(MERCHANT_BUYS);
        earned += MERCHANT_BUYS * GOOD_PRICE[g];
        sold.push(`${MERCHANT_BUYS} ${GOOD_LABEL[g]}`);
      }
    }
    if (earned) sqlite.prepare("UPDATE economy SET treasury = treasury + ? WHERE id = 1").run(earned);
    let iron = "";
    const cost = MERCHANT_IRON.qty * MERCHANT_IRON.price;
    if (wantsIron && (eco.treasury ?? 0) + earned >= cost) {
      sqlite.prepare("UPDATE economy SET iron = iron + ?, treasury = treasury - ? WHERE id = 1").run(MERCHANT_IRON.qty, cost);
      iron = ` The smithy bought ${MERCHANT_IRON.qty} bars of iron for ${cost} coins.`;
    }
    note("merchant", `A travelling merchant set up in the square${sold.length ? ` and bought ${sold.join(", ")} for ${earned} coins` : ""}.${iron}`);
  }

  if (rng() < CHANCE.fair(s.season)) {
    const town = makeOrder(0, rng).town;
    const insert = sqlite.prepare("INSERT INTO trade_orders (town, good, qty, reward, due_at) VALUES (?, ?, ?, ?, ?)");
    const extra: Good[] = [...(built("mill") ? ["flour" as const] : []), ...(built("smithy") ? ["tools" as const] : [])];
    for (let i = 0; i < 2; i++) {
      const o = makeOrder((eco.reputation ?? 0) + 3, rng, extra);
      insert.run(town, o.good, o.qty, o.reward, Math.floor(now.getTime() / 1000) + ORDER_DAYS * 86400);
    }
    note("fair", `There's a fair at ${town}: they've sent two orders for the trading post.`);
  }
  return happened;
}

// Tools wear out (#188): one for every four villagers at work, each day.
function wearTools() {
  const workers = (sqlite.prepare("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'").get() as { n: number }).n;
  sqlite.prepare("UPDATE economy SET tools = MAX(0, tools - ?) WHERE id = 1").run(Math.ceil(workers / 4));
}

// The harvest festival on the village calendar, once a year, on the given
// village day: the whole day on the village's own clock, all day on the owner's.
export function harvestFestival(day: number, clock: VillageClock, dayHours: number) {
  {
    ensureCalendarTables();
    if (sqlite.prepare("SELECT 1 FROM village_events WHERE source = 'season' AND source_id = ?").get(day)) return;
    const start = villageDayStart(day, clock, dayHours);
    const pad = (n: number) => String(n).padStart(2, "0");
    const ymd = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const when = clock === "real" ? ymd : `${ymd} ${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const end = clock === "real" ? null : new Date(start.getTime() + dayHours * 3_600_000 - 60_000);
    const endText = end ? `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())} ${pad(end.getHours())}:${pad(end.getMinutes())}` : undefined;
    try {
      addEvent(
        { title: "Harvest festival", kind: "festival", when, end: endText, place: "the village square", notes: "Food, ale and music to celebrate the harvest." },
        { source: "season", sourceId: day },
      );
    } catch {
      /* its day has already passed: no festival this year */
    }
  }
}

// For THE VILLAGE TODAY: the season and what's happening.
export function seasonLines(now: Date, clock: VillageClock, dayHours: number): string[] {
  const s = seasonOf(now, clock, dayHours);
  const today = happeningsOn(s.dayNumber).map((h) => h.note);
  return [`- The season: ${SEASON_NOTE[s.season]} (day ${s.day}${clock === "real" ? "" : ` of ${7}`}).`, today.length ? `- Today in the village: ${today.join(" ")}` : ""].filter(Boolean);
}
