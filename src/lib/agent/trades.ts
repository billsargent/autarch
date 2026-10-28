// Village trades (#131): what a villager does with their days, separate from
// helping the owner with the computer. Plain data, safe in the browser.
// `building`: the kind of building that's their workplace (they keep it);
// `spot`: where they work when there's no such building (a waypoint id in the
// village scene); `goods`: what a working stint makes for the village.

export type Good = "wheat" | "flour" | "bread" | "fish" | "flowers" | "crafts" | "ale" | "iron" | "tools";
export const GOODS: Good[] = ["wheat", "flour", "bread", "fish", "flowers", "crafts", "ale", "iron", "tools"];
export const GOOD_LABEL: Record<Good, string> = {
  wheat: "wheat",
  flour: "sacks of flour",
  bread: "loaves",
  fish: "fish",
  flowers: "flowers",
  crafts: "crafts",
  ale: "ale",
  iron: "bars of iron",
  tools: "tools",
};
export const GOOD_ICON: Record<Good, string> = { wheat: "🌾", flour: "🥣", bread: "🍞", fish: "🐟", flowers: "🌷", crafts: "🪵", ale: "🍺", iron: "🔩", tools: "🔨" };

export interface Trade {
  label: string;
  // Doing it, for bubbles and the chronicle ("baking").
  doing: string;
  icon: string;
  building: "farm" | "mill" | "bakery" | "tavern" | "garden" | "shop" | "workshop" | "smithy" | null;
  spot: string;
  goods: Good | null;
  // What a stint uses up (a miller grinds wheat into flour).
  uses?: Good;
  // What it makes do with when there's none of that, at half the output (a
  // baker with no flour bakes straight from wheat, #186).
  makesDoWith?: Good;
}

export const TRADES = {
  farmer: { label: "Farmer", doing: "working the fields", icon: "🌾", building: "farm", spot: "nj", goods: "wheat" },
  miller: { label: "Miller", doing: "grinding at the mill", icon: "⚙️", building: "mill", spot: "nj", goods: "flour", uses: "wheat" },
  baker: { label: "Baker", doing: "baking", icon: "🍞", building: "bakery", spot: "tc", goods: "bread", uses: "flour", makesDoWith: "wheat" },
  fisher: { label: "Fisher", doing: "fishing at the pond", icon: "🎣", building: null, spot: "c", goods: "fish" },
  innkeeper: { label: "Innkeeper", doing: "keeping the inn", icon: "🍺", building: "tavern", spot: "tr", goods: "ale", uses: "wheat" },
  gardener: { label: "Gardener", doing: "tending the flowers", icon: "🌷", building: "garden", spot: "bc", goods: "flowers" },
  shopkeeper: { label: "Shopkeeper", doing: "minding the shop", icon: "🛍️", building: "shop", spot: "tc", goods: null },
  carpenter: { label: "Carpenter", doing: "at the workbench", icon: "🪚", building: "workshop", spot: "ws", goods: "crafts" },
  // The blacksmith (#188): iron from the travelling merchant into tools.
  smith: { label: "Blacksmith", doing: "at the forge", icon: "⚒️", building: "smithy", spot: "ws", goods: "tools", uses: "iron" },
  trader: { label: "Trader", doing: "seeing to the carts at the storehouse", icon: "🐴", building: null, spot: "sh", goods: null },
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
  [/mill|grind|flour/i, "miller"],
  [/farm|field|harvest|crop/i, "farmer"],
  [/bak|bread|pastr/i, "baker"],
  [/fish|angl|boat/i, "fisher"],
  [/inn|tavern|brew|ale|bar/i, "innkeeper"],
  [/garden|weed|herb|flower|plant/i, "gardener"],
  [/shop|merchant|sell|market/i, "shopkeeper"],
  [/smith|forge|anvil|iron/i, "smith"],
  [/carpent|build|wood|craft|fix|maker/i, "carpenter"],
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

// What a stint of `n` takes from the stores and how much it makes (#186):
// from what the trade uses, or else from what it makes do with, at half the
// output (rounded down; a single one becomes a coin toss). Nothing to use: 0.
export function stintInputs(
  t: { uses?: Good; makesDoWith?: Good },
  n: number,
  stock: Partial<Record<Good, number>>,
  rng: () => number = Math.random,
): { made: number; used: Good | null } {
  if (!n || !t.uses) return { made: n, used: null };
  const have = stock[t.uses] ?? 0;
  if (have > 0) return { made: Math.min(n, have), used: t.uses };
  if (!t.makesDoWith) return { made: 0, used: null };
  const half = Math.floor(n / 2) || (rng() < 0.5 ? 1 : 0);
  const made = Math.min(half, stock[t.makesDoWith] ?? 0);
  return made ? { made, used: t.makesDoWith } : { made: 0, used: null };
}

// Skill: a level from experience, and a title for it.
export const levelOf = (xp: number) => Math.min(10, Math.floor(Math.sqrt(Math.max(0, xp) / 20)) + 1);
export function titleOf(trade: TradeKey, level: number): string {
  if (trade === "mayor") return "Mayor"; // not a trade you rise in
  const prefix = level >= 8 ? "Master" : level >= 5 ? "Skilled" : level <= 1 ? "Apprentice" : "";
  return prefix ? `${prefix} ${TRADES[trade].label.toLowerCase()}` : TRADES[trade].label;
}
