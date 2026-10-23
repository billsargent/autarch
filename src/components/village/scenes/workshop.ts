// The workshop: the agent's scheduled jobs are slips pinned to the job board,
// and new jobs are set up at the workbench.
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

export const WORKSHOP_SCENE: SceneLayout = {
  id: "workshop",
  title: "The workshop",
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
    { stamp: "windowBlue", col: 3, row: 0 },
    { stamp: "windowRed", col: 11, row: 0 },
    { stamp: "doormat", col: 7, row: H - 2 },
  ],
  places: [
    {
      id: "board",
      label: "Job board",
      role: "The agent's scheduled jobs — open a slip to run, pause, edit or check its history",
      door: "board",
      action: "jobs.board",
      parts: [{ stamp: "jobBoard", col: 6, row: 3 }],
    },
    {
      id: "bench",
      label: "Workbench",
      role: "Set up a new job",
      door: "bench",
      action: "jobs.new",
      parts: [{ stamp: "workbench", col: 2, row: 6 }],
    },
  ],
  decor: [
    { stamp: "toolShelf", col: 12, row: 2 },
    { stamp: "drawers", col: 1, row: 2 },
    { stamp: "grindstone", col: 1, row: 6 },
    { stamp: "scrapPile", col: 5, row: 6 },
    { stamp: "ropeCoil", col: 4, row: 3 },
    { stamp: "sack", col: 2, row: 3 },
    { stamp: "sackOpen", col: 3, row: 3 },
    { stamp: "lumber", col: 10, row: 3 },
    { stamp: "plankStack", col: 11, row: 3 },
    { stamp: "barrelBands", col: 14, row: 3 },
    { stamp: "stump", col: 11, row: 7 },
    { stamp: "handcart", col: 12, row: 7 },
    { stamp: "chest", col: 14, row: 5 },
  ],
  lamps: [],
  walkable: [FLOOR, DOORWAY],
  waypoints: [
    { id: "door", x: 8, y: 10.4 },
    { id: "center", x: 8, y: 8.6 },
    { id: "board", x: 7.5, y: 4.6 },
    { id: "bench", x: 3.5, y: 7.6 },
    { id: "pile", x: 10.5, y: 6.6 },
  ],
  edges: [
    ["door", "center"],
    ["center", "board"],
    ["center", "bench"],
    ["center", "pile"],
  ],
  spawn: "door",
  exit: "door",
};
