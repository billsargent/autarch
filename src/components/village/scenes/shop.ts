// The shop (#154): shelves of things for the cottages, the counter and the
// shopkeeper's desk. Villagers buy decor and treats here.
import { interior } from "./shell";

export const SHOP_SCENE = interior({
  id: "shop",
  title: "The shop",
  ground: [
    { stamp: "windowBlue", col: 7, row: 0 },
    { stamp: "bigRug", col: 6, row: 7 },
  ],
  places: [
    {
      id: "counter",
      label: "The counter",
      role: "What's for sale, and what the villagers bought lately",
      door: "counter",
      action: "shop.counter",
      parts: [{ stamp: "workbench", col: 6, row: 5 }],
    },
    {
      id: "desk",
      label: "The shopkeeper's desk",
      role: "Who minds the shop",
      door: "desk",
      action: "shop.keeper",
      parts: [{ stamp: "writingDesk", col: 12, row: 3 }],
    },
  ],
  decor: [
    { stamp: "emptyShelf", col: 2, row: 3 },
    { stamp: "darkDresser", col: 4, row: 3 },
    { stamp: "pottedPlant", col: 10, row: 3 },
    { stamp: "clayPot", col: 11, row: 3 },
    { stamp: "produceCrate", col: 1, row: 6 },
    { stamp: "barrelBands", col: 1, row: 7 },
    { stamp: "crateSmall", col: 14, row: 7 },
    { stamp: "smallChest", col: 14, row: 8 },
    { stamp: "candle", col: 14, row: 3 },
  ],
  waypoints: [
    { id: "counter", x: 7.5, y: 6.6 },
    { id: "desk", x: 12.5, y: 5.6 },
  ],
  edges: [
    ["center", "counter"],
    ["center", "desk"],
  ],
});
