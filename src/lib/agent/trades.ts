// Village trades (#131): what a villager does with their days, separate from
// helping the owner with the computer. Plain data, safe in the browser.
// `building`: the kind of building that's their workplace (they keep it);
// `spot`: where they work when there's no such building (a waypoint id in the
// village scene); `goods`: what a working stint makes for the village.

export type Good = "wheat" | "bread" | "fish" | "flowers" | "crafts" | "ale";
export const GOODS: Good[] = ["wheat", "bread", "fish", "flowers", "crafts", "ale"];
export const GOOD_LABEL: Record<Good, string> = { wheat: "wheat", bread: "loaves", fish: "fish", flowers: "flowers", crafts: "crafts", ale: "ale" };
export const GOOD_ICON: Record<Good, string> = { wheat: "🌾", bread: "🍞", fish: "🐟", flowers: "🌷", crafts: "🪵", ale: "🍺" };

export interface Trade {
  label: string;
  // Doing it, for bubbles and the chronicle ("baking").
  doing: string;
  icon: string;
  building: "farm" | "bakery" | "tavern" | "garden" | "shop" | "workshop" | null;
  spot: string;
  goods: Good | null;
  // What a stint uses up (a baker bakes wheat into bread).
  uses?: Good;
}

export const TRADES = {
  farmer: { label: "Farmer", doing: "working the fields", icon: "🌾", building: "farm", spot: "nj", goods: "wheat" },
  baker: { label: "Baker", doing: "baking", icon: "🍞", building: "bakery", spot: "tc", goods: "bread", uses: "wheat" },
  fisher: { label: "Fisher", doing: "fishing at the pond", icon: "🎣", building: null, spot: "c", goods: "fish" },
  innkeeper: { label: "Innkeeper", doing: "keeping the inn", icon: "🍺", building: "tavern", spot: "tr", goods: "ale", uses: "wheat" },
  gardener: { label: "Gardener", doing: "tending the flowers", icon: "🌷", building: "garden", spot: "bc", goods: "flowers" },
  shopkeeper: { label: "Shopkeeper", doing: "minding the shop", icon: "🛍️", building: "shop", spot: "tc", goods: null },
  carpenter: { label: "Carpenter", doing: "at the workbench", icon: "🪚", building: "workshop", spot: "ws", goods: "crafts" },
  trader: { label: "Trader", doing: "seeing to the carts", icon: "🐴", building: null, spot: "wg", goods: null },
  scholar: { label: "Scholar", doing: "reading in the library", icon: "📚", building: null, spot: "lib", goods: null },
  watchman: { label: "Watchman", doing: "keeping watch", icon: "🛡️", building: null, spot: "gt", goods: null },
  mayor: { label: "Mayor", doing: "seeing to the village", icon: "🎩", building: null, spot: "c", goods: null },
  helper: { label: "Odd-jobber", doing: "lending a hand", icon: "🧺", building: null, spot: "c", goods: null },
} satisfies Record<string, Trade>;

export type TradeKey = keyof typeof TRADES;
export const TRADE_KEYS = Object.keys(TRADES) as TradeKey[];
export const isTradeKey = (v: unknown): v is TradeKey => typeof v === "string" && v in TRADES;

// A best guess from a villager's role ("Head gardener" → gardener).
const GUESSES: Array<[RegExp, TradeKey]> = [
  [/farm|field|harvest|crop/i, "farmer"],
  [/bak|bread|pastr/i, "baker"],
  [/fish|angl|boat/i, "fisher"],
  [/inn|tavern|brew|ale|bar/i, "innkeeper"],
  [/garden|weed|herb|flower|plant/i, "gardener"],
  [/shop|merchant|sell|market/i, "shopkeeper"],
  [/carpent|build|wood|craft|smith|fix|maker/i, "carpenter"],
  [/trade|export|cart|courier/i, "trader"],
  [/librar|scholar|read|book|study|teach|research/i, "scholar"],
  [/watch|guard|night|sentry|security/i, "watchman"],
];

export function guessTrade(role: string | null | undefined, isMayor = false): TradeKey {
  if (isMayor) return "mayor";
  for (const [re, t] of GUESSES) if (re.test(role ?? "")) return t;
  return "helper";
}

// A villager's trade: what the owner chose, or the guess.
export const tradeOf = (v: { trade?: string | null; role?: string | null; isMayor?: boolean }): TradeKey =>
  isTradeKey(v.trade) ? v.trade : guessTrade(v.role, v.isMayor);

// Skill: a level from experience, and a title for it.
export const levelOf = (xp: number) => Math.min(10, Math.floor(Math.sqrt(Math.max(0, xp) / 20)) + 1);
export function titleOf(trade: TradeKey, level: number): string {
  const prefix = level >= 8 ? "Master" : level >= 5 ? "Skilled" : level <= 1 ? "Apprentice" : "";
  return prefix ? `${prefix} ${TRADES[trade].label.toLowerCase()}` : TRADES[trade].label;
}
