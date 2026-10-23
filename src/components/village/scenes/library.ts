// The library: the agent's skills (markdown playbooks) live on the shelves,
// and new ones are written at the desk.
import type { Placement, Rect, SceneLayout } from "../scene";

const W = 16;
const H = 11;
const FLOOR: Rect = { col: 1, row: 3, w: W - 2, h: H - 4 };
const DOORWAY: Rect = { col: 7, row: H - 1, w: 2, h: 1 };

// Thick wall rim around the sides and bottom, with rounded ends at the doorway.
const rim: Placement[] = [
  { stamp: "rimCornerBL", col: 0, row: H - 1 },
  { stamp: "rimCornerBR", col: W - 1, row: H - 1 },
  { stamp: "rimBottomEndRight", col: DOORWAY.col - 1, row: H - 1 },
  { stamp: "rimBottomEndLeft", col: DOORWAY.col + DOORWAY.w, row: H - 1 },
];

export const LIBRARY_SCENE: SceneLayout = {
  id: "library",
  title: "The library",
  cols: W,
  rows: H,
  fill: [{ stamp: "plankFloor", weight: 1 }],
  areas: [
    // Back wall: cap, plaster, brick.
    { rect: { col: 1, row: 0, w: W - 2, h: 1 }, stamp: "wallCap" },
    { rect: { col: 1, row: 1, w: W - 2, h: 1 }, stamp: "wallPlaster" },
    { rect: { col: 1, row: 2, w: W - 2, h: 1 }, stamp: "wallBrick" },
    // Side and bottom rims.
    { rect: { col: 0, row: 0, w: 1, h: H - 1 }, stamp: "rimLeft" },
    { rect: { col: W - 1, row: 0, w: 1, h: H - 1 }, stamp: "rimRight" },
    { rect: { col: 1, row: H - 1, w: DOORWAY.col - 2, h: 1 }, stamp: "rimBottom" },
    { rect: { col: DOORWAY.col + DOORWAY.w + 1, row: H - 1, w: W - 2 - DOORWAY.col - DOORWAY.w, h: 1 }, stamp: "rimBottom" },
  ],
  ground: [
    ...rim,
    { stamp: "windowRed", col: 3, row: 0 },
    { stamp: "windowBlue", col: 11, row: 0 },
    { stamp: "bigRug", col: 6, row: 5 },
    { stamp: "doormat", col: 7, row: H - 2 },
  ],
  places: [
    {
      id: "shelves",
      label: "Bookshelves",
      role: "The agent's skills — open one to read or edit it",
      door: "shelf",
      action: "skills.browse",
      parts: [
        { stamp: "bookshelf", col: 1, row: 2 },
        { stamp: "tallBookshelf", col: 6, row: 2 },
        { stamp: "tallBookshelf", col: 8, row: 2 },
        { stamp: "bookshelf", col: 13, row: 2 },
      ],
    },
    {
      id: "desk",
      label: "Writing desk",
      role: "Write a new skill",
      door: "desk",
      action: "skills.new",
      parts: [{ stamp: "writingDesk", col: 2, row: 6 }],
    },
  ],
  decor: [
    { stamp: "readingTable", col: 11, row: 6 },
    { stamp: "chairRed", col: 10, row: 6 },
    { stamp: "chairBlue", col: 13, row: 6 },
    { stamp: "pottedPlant", col: 1, row: 4 },
    { stamp: "pottedPlant", col: 14, row: 4 },
  ],
  lamps: [],
  walkable: [FLOOR, DOORWAY],
  waypoints: [
    { id: "door", x: 8, y: 10.4 },
    { id: "center", x: 8, y: 8.6 },
    { id: "shelf", x: 8, y: 4.6 },
    { id: "desk", x: 3, y: 8.6 },
    { id: "table", x: 12, y: 8.6 },
  ],
  edges: [
    ["door", "center"],
    ["center", "shelf"],
    ["center", "desk"],
    ["center", "table"],
  ],
  spawn: "door",
  exit: "door",
};
