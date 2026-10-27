// The tavern (#154): the bar with its barrels, tables by the hearth. The
// innkeeper brews ale from the village's wheat here, and villagers spend
// their evenings here.
import { interior } from "./shell";

export const TAVERN_SCENE = interior({
  id: "tavern",
  title: "The tavern",
  ground: [
    { stamp: "windowRed", col: 3, row: 0 },
    { stamp: "windowBlue", col: 10, row: 0 },
    { stamp: "redBanner", col: 7, row: 1 },
  ],
  places: [
    {
      id: "bar",
      label: "The bar",
      role: "The ale in the stores, who's in tonight, and what a supper costs",
      door: "bar",
      action: "tavern.bar",
      parts: [
        { stamp: "barrelBands", col: 1, row: 3 },
        { stamp: "barrelBands", col: 2, row: 3 },
        { stamp: "barrel", col: 3, row: 3 },
        { stamp: "workbench", col: 2, row: 5 },
      ],
    },
    {
      id: "hearth",
      label: "The hearth",
      role: "Who keeps the tavern",
      door: "hearth",
      action: "tavern.keeper",
      parts: [{ stamp: "hearth", col: 12, row: 3 }],
    },
  ],
  decor: [
    { stamp: "roundTable", col: 6, row: 4 },
    { stamp: "stumpSeat", col: 5, row: 5 },
    { stamp: "stumpSeat", col: 8, row: 5 },
    { stamp: "roundTable", col: 9, row: 6 },
    { stamp: "chairBlue", col: 8, row: 7 },
    { stamp: "chairRed", col: 11, row: 7 },
    { stamp: "logBench", col: 1, row: 8 },
    { stamp: "bigBarrel", col: 13, row: 7 },
    { stamp: "pottedPlant", col: 14, row: 3 },
    { stamp: "candle", col: 14, row: 5 },
  ],
  waypoints: [
    { id: "bar", x: 3.5, y: 6.6 },
    { id: "hearth", x: 12.5, y: 5.6 },
  ],
  edges: [
    ["center", "bar"],
    ["center", "hearth"],
  ],
});
