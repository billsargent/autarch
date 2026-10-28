// The riverside (#190): a second area, reached by the road out of the
// village's east gate. A river runs across it, with a jetty and a rowing boat
// moored beside it; the fishers work here now, and the boat takes the
// village's goods downriver. Outdoors, so it's laid out like the village (no
// walls); like a building, its way back is the road it was reached by.
import type { Rect, SceneLayout } from "../scene";

const ROAD: Rect = { col: 0, row: 5, w: 18, h: 2 }; // in from the village
const LANE: Rect = { col: 16, row: 5, w: 2, h: 7 }; // down to the river
const JETTY: Rect = { col: 15, row: 12, w: 4, h: 3 }; // planks out over the water
export const RIVER: Rect = { col: 0, row: 12, w: 36, h: 6 };

export const RIVERSIDE_SCENE: SceneLayout = {
  id: "riverside",
  title: "The riverside",
  cols: 36,
  rows: 22,
  fill: [
    { stamp: "svGrassTuft", weight: 0.06 },
    { stamp: "svGrassTuft2", weight: 0.06 },
    { stamp: "svGrass", weight: 0.88 },
  ],
  paths: { rects: [ROAD, LANE], blob: "svPathBlob" },
  water: { rects: [RIVER], blob: "waterBlob" },
  walkable: [ROAD, LANE, JETTY],
  places: [
    {
      id: "jetty",
      label: "The jetty",
      role: "Where the fishers work: who's fishing, the catch, and what the season's doing to it",
      action: "riverside.docks",
      door: "jetty",
      parts: [{ stamp: "jetty", col: 15, row: 12 }],
    },
    {
      id: "boat",
      label: "The boat",
      role: "The village's goods going downriver: the orders it's carrying",
      action: "riverside.boat",
      door: "boat",
      parts: [{ stamp: "rowboat", col: 19, row: 14 }],
    },
  ],
  decor: [
    { stamp: "barrel", col: 13, row: 10 },
    { stamp: "produceCrate", col: 14, row: 10 },
    { stamp: "barrel", col: 19, row: 10 },
    { stamp: "svSignLeft", col: 1, row: 3 },
    { stamp: "svTree", col: 3, row: 0 },
    { stamp: "pineTree", col: 8, row: 1 },
    { stamp: "roundTree", col: 22, row: 1 },
    { stamp: "svTree", col: 28, row: 2 },
    { stamp: "leafyTree", col: 32, row: 6 },
    { stamp: "pineTree", col: 25, row: 7 },
    { stamp: "svTree", col: 6, row: 8 },
    { stamp: "pineTree", col: 2, row: 19 },
    { stamp: "svTree", col: 10, row: 18 },
    { stamp: "roundTree", col: 17, row: 19 },
    { stamp: "svTree", col: 24, row: 18 },
    { stamp: "pineTree", col: 31, row: 19 },
    { stamp: "svFlowersPatch", col: 21, row: 8 },
    { stamp: "svFlowersPatch", col: 9, row: 3 },
  ],
  lamps: [],
  scatter: { stamps: ["svFlowerRed", "svFlowerBig", "svFlowerTeal", "svFlowerTeal2", "svBush"], count: 30, seed: 20261029 },
  waypoints: [
    { id: "door", x: 0.6, y: 6 }, // the road back to the village
    { id: "center", x: 10, y: 6 },
    { id: "lane", x: 17, y: 6 },
    // On the jetty's planks.
    { id: "jetty", x: 16.5, y: 13.4, onFurniture: true },
    { id: "boat", x: 18.4, y: 13.6, onFurniture: true },
  ],
  edges: [
    ["door", "center"],
    ["center", "lane"],
    ["lane", "jetty"],
    ["jetty", "boat"],
  ],
  spawn: "door",
  exit: "door",
  hangouts: ["center", "jetty"],
};
