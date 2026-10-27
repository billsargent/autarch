// The bakery (#154): the oven, sacks of flour and the baker's table. The
// baker bakes the village's wheat into loaves here.
import { interior } from "./shell";

export const BAKERY_SCENE = interior({
  id: "bakery",
  title: "The bakery",
  floor: "stoneFloor",
  ground: [{ stamp: "windowRed", col: 11, row: 0 }],
  places: [
    {
      id: "oven",
      label: "The oven",
      role: "Bread and wheat in the stores, and today's baking",
      door: "oven",
      action: "bakery.oven",
      parts: [
        { stamp: "hearth", col: 2, row: 3 },
        { stamp: "clayPot", col: 4, row: 3 },
      ],
    },
    {
      id: "table",
      label: "The baker's table",
      role: "Who bakes here",
      door: "table",
      action: "bakery.keeper",
      parts: [{ stamp: "readingTable", col: 10, row: 4 }],
    },
  ],
  decor: [
    { stamp: "sack", col: 6, row: 3 },
    { stamp: "sackOpen", col: 7, row: 3 },
    { stamp: "sack", col: 8, row: 3 },
    { stamp: "produceCrate", col: 13, row: 3 },
    { stamp: "emptyShelf", col: 13, row: 5 },
    { stamp: "barrel", col: 1, row: 7 },
    { stamp: "crateSmall", col: 1, row: 8 },
    { stamp: "chest", col: 14, row: 8 },
    { stamp: "pottedPlant", col: 5, row: 8 },
  ],
  waypoints: [
    { id: "oven", x: 3, y: 5.6 },
    { id: "table", x: 10.5, y: 6.6 },
  ],
  edges: [
    ["center", "oven"],
    ["center", "table"],
  ],
});
