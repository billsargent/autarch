// The agent's cottage: talk in the armchair by the hearth (the full chat) and
// read the diary on the desk (the journal). Each agent gets its own cottage
// once there are several (#55).
import { interior } from "./shell";

export const COTTAGE_SCENE = interior({
  id: "cottage",
  title: "The cottage",
  ground: [
    { stamp: "windowRed", col: 3, row: 0 },
    { stamp: "windowBlue", col: 11, row: 0 },
    { stamp: "painting", col: 7, row: 1 },
    { stamp: "bigRug", col: 5, row: 5 },
  ],
  places: [
    {
      id: "armchair",
      label: "Armchair by the hearth",
      role: "Sit and talk — every conversation, with tools, uploads and live activity",
      door: "hearth",
      action: "chat.open",
      parts: [
        { stamp: "hearth", col: 6, row: 3 },
        { stamp: "chairRed", col: 8, row: 4 },
      ],
    },
    {
      id: "diary",
      label: "Diary",
      role: "The agent's journal — what it has been exploring, building and thinking",
      door: "diary",
      action: "journal.open",
      parts: [{ stamp: "writingDesk", col: 1, row: 6 }],
    },
  ],
  decor: [
    { stamp: "bedRed", col: 12, row: 3 },
    { stamp: "drawers", col: 14, row: 3 },
    { stamp: "tallBookshelf", col: 1, row: 2 },
    { stamp: "pottedPlant", col: 4, row: 3 },
    { stamp: "book", col: 3, row: 7 },
    { stamp: "clayPot", col: 14, row: 8 },
    { stamp: "chairBlue", col: 11, row: 7 },
  ],
  waypoints: [
    { id: "hearth", x: 8.5, y: 6 },
    { id: "diary", x: 3, y: 8.6 },
    { id: "bed", x: 11.5, y: 6.6 },
  ],
  edges: [
    ["center", "hearth"],
    ["center", "diary"],
    ["center", "bed"],
  ],
});
