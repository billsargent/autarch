// The village shop (#135): what villagers can buy with their coins (the
// village's own, never real money). Decor stands in the buyer's cottage, in
// the next free slot of its kind; a treat is eaten on the spot; flowers are
// for giving. Plain data, safe in the browser.

export interface ShopItem {
  label: string;
  price: number;
  kind: "floor" | "wall" | "treat" | "gift";
  // The stamp drawn in the cottage (components/village/scene.ts), for decor.
  stamp?: string;
}

export const SHOP = {
  plant: { label: "a potted plant", price: 8, kind: "floor", stamp: "pottedPlant" },
  pot: { label: "a clay pot", price: 5, kind: "floor", stamp: "clayPot" },
  chest: { label: "a little chest", price: 10, kind: "floor", stamp: "smallChest" },
  armchair: { label: "a blue armchair", price: 12, kind: "floor", stamp: "chairBlue" },
  candle: { label: "a candle", price: 4, kind: "floor", stamp: "candle" },
  books: { label: "a stack of books", price: 6, kind: "floor", stamp: "book" },
  barrel: { label: "a barrel", price: 8, kind: "floor", stamp: "barrelBands" },
  painting: { label: "a painting", price: 15, kind: "wall", stamp: "painting" },
  map: { label: "a map for the wall", price: 12, kind: "wall", stamp: "mapPainting" },
  banner: { label: "a red banner", price: 10, kind: "wall", stamp: "redBanner" },
  pie: { label: "a slice of pie", price: 3, kind: "treat" },
  flowers: { label: "a bunch of flowers", price: 4, kind: "gift" },
} satisfies Record<string, ShopItem>;

export type ShopKey = keyof typeof SHOP;
export const SHOP_KEYS = Object.keys(SHOP) as ShopKey[];
export const isShopKey = (v: unknown): v is ShopKey => typeof v === "string" && v in SHOP;

// Where decor goes in a cottage (scenes/cottage.ts), in tiles, filled in order.
export const DECOR_SLOTS = {
  floor: [
    { col: 10, row: 3 },
    { col: 13, row: 8 },
    { col: 9, row: 8 },
    { col: 4, row: 9 },
    { col: 2, row: 4 },
  ],
  wall: [
    { col: 9, row: 1 },
    { col: 14, row: 1 },
    { col: 1, row: 1 },
  ],
} as const;

// Which decor shows where: the newest pieces, as many as there are slots.
export function placeDecor(decor: string[]): Array<{ item: ShopKey; col: number; row: number }> {
  const out: Array<{ item: ShopKey; col: number; row: number }> = [];
  for (const kind of ["floor", "wall"] as const) {
    const items = decor.filter((d): d is ShopKey => isShopKey(d) && SHOP[d].kind === kind).slice(-DECOR_SLOTS[kind].length);
    items.forEach((item, i) => out.push({ item, ...DECOR_SLOTS[kind][i] }));
  }
  return out;
}
