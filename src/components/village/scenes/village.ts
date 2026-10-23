// The village: buildings, roads and scenery. Each building is a place the
// villagers walk to; buildings with a room open it, outdoor things (the notice
// board) open their dialogs in place, and the rest link to their Command
// Center page until their room is built.
import type { Rect, SceneLayout } from "../scene";

// Roads are two tiles wide so the path edges render cleanly.
const ROADS: Rect[] = [
  { col: 2, row: 9, w: 36, h: 2 }, // upper street
  { col: 2, row: 16, w: 36, h: 2 }, // lower street
  { col: 2, row: 9, w: 2, h: 9 }, // west lane
  { col: 19, row: 8, w: 2, h: 10 }, // main lane, town hall to guard tower
  { col: 36, row: 9, w: 2, h: 9 }, // east lane
  { col: 0, row: 9, w: 2, h: 2 }, // west road, out of town
  { col: 27, row: 0, w: 2, h: 9 }, // north road, out of town
];

export const VILLAGE_SCENE: SceneLayout = {
  id: "village",
  title: "The village",
  cols: 40,
  rows: 23,
  fill: [
    { stamp: "svGrassTuft", weight: 0.06 },
    { stamp: "svGrassTuft2", weight: 0.06 },
    { stamp: "svGrass", weight: 0.88 },
  ],
  paths: { rects: ROADS, blob: "svPathBlob" },
  walkable: ROADS,
  places: [
    { id: "workshop", label: "Workshop", role: "Jobs — the agent's scheduled work", interior: "workshop", door: "ws", parts: [{ stamp: "barn", col: 4, row: 3 }] },
    { id: "townhall", label: "Town hall", role: "Approvals — and, later, town meetings", interior: "townhall", door: "tc", parts: [{ stamp: "hall", col: 18, row: 1 }] },
    { id: "library", label: "Library", role: "Skills — the agent's playbooks", interior: "library", door: "lib", parts: [{ stamp: "svHouseBlueBig", col: 30, row: 4 }] },
    { id: "noticeboard", label: "Notice board", role: "Goals pinned for the agent", action: "goals.board", door: "nb", parts: [{ stamp: "svNoticeBoard", col: 5, row: 12 }] },
    { id: "pond", label: "Village pond", role: "The plaza — where villagers gather", door: "c", parts: [{ stamp: "svPond", col: 22, row: 12 }] },
    { id: "observatory", label: "Observatory", role: "The system monitor", interior: "observatory", door: "obs", parts: [{ stamp: "dome", col: 31, row: 11 }] },
    {
      id: "cottages",
      label: "Cottages",
      role: "Where agents live — talk by the hearth, read the diary",
      interior: "cottage",
      door: "cot",
      parts: [
        { stamp: "svHouseRed", col: 4, row: 18 },
        { stamp: "svHouseBlue", col: 9, row: 18 },
        { stamp: "svHouseRedBig", col: 13, row: 18 },
      ],
    },
    { id: "mailbox", label: "Mailbox", role: "Letters from the agents — notifications", action: "mail.open", door: "bl", parts: [{ stamp: "svMailbox", col: 3, row: 19 }] },
    { id: "guardtower", label: "Guard tower", role: "The town watch — the activity log", interior: "guardtower", door: "gt", parts: [{ stamp: "lookout", col: 19, row: 18 }] },
    { id: "vault", label: "Vault", role: "Budget and spending", interior: "vault", door: "vlt", parts: [{ stamp: "stoneHouse", col: 25, row: 18 }] },
  ],
  // Scenery with no hotspot.
  decor: [
    { stamp: "fishShop", col: 24, row: 4 },
    { stamp: "greenMarket", col: 9, row: 4 },
    { stamp: "beigeHouse", col: 35, row: 19 },
    { stamp: "marketStall", col: 9, row: 12 },
    { stamp: "barrel", col: 12, row: 13 },
    { stamp: "produceCrate", col: 8, row: 13 },
    { stamp: "svFlowersPatch", col: 26, row: 13 },
    { stamp: "svTree", col: 0, row: 0 },
    { stamp: "svTree", col: 14, row: 0 },
    { stamp: "svTree", col: 30, row: 0 },
    { stamp: "svTree", col: 38, row: 3 },
    { stamp: "svTree", col: 0, row: 5 },
    { stamp: "svTree", col: 0, row: 19 },
    { stamp: "svTree", col: 38, row: 12 },
    { stamp: "svTree", col: 22, row: 19 },
    { stamp: "svTree", col: 29, row: 19 },
    { stamp: "roundTree", col: 16, row: 1 },
    { stamp: "roundTree", col: 23, row: 1 },
    { stamp: "leafyTree", col: 35, row: 1 },
    { stamp: "pineTree", col: 2, row: 1 },
    { stamp: "pineTree", col: 33, row: 19 },
    { stamp: "pineTree", col: 16, row: 12 },
    // Signposts at the roads out of town.
    { stamp: "svSignLeft", col: 2, row: 8 },
    { stamp: "svSign", col: 26, row: 7 },
  ],
  lamps: [
    { stamp: "lampPost", col: 8, row: 7 },
    { stamp: "lampPost", col: 15, row: 7 },
    { stamp: "lampPost", col: 23, row: 7 },
    { stamp: "lampPost", col: 29, row: 7 },
    { stamp: "lampPost", col: 15, row: 14 },
    { stamp: "lampPost", col: 29, row: 14 },
  ],
  scatter: { stamps: ["svFlowerRed", "svFlowerBig", "svFlowerTeal", "svFlowerTeal2", "svBush"], count: 46, seed: 20261023 },
  // Doors of buildings below the lower street are offset sideways so a
  // villager standing there doesn't cover the building's sign.
  waypoints: [
    { id: "wg", x: 0.6, y: 10 }, // west gate
    { id: "ng", x: 28, y: 0.6 }, // north gate
    { id: "nj", x: 28, y: 10 }, // north road junction
    { id: "tl", x: 3, y: 10 },
    { id: "ws", x: 6, y: 10 },
    { id: "tc", x: 20, y: 10 },
    { id: "lib", x: 30.5, y: 10 }, // left of the door, clear of the observatory sign
    { id: "tr", x: 37, y: 10 },
    { id: "nb", x: 3, y: 13 },
    { id: "c", x: 20, y: 13.5 },
    { id: "bl", x: 3, y: 17 },
    { id: "cot", x: 7, y: 17 },
    { id: "bc", x: 20, y: 17 },
    { id: "gt", x: 22.5, y: 17 },
    { id: "vlt", x: 29, y: 17 },
    { id: "obs", x: 32.5, y: 17 },
    { id: "br", x: 37, y: 17 },
  ],
  edges: [
    ["tl", "ws"],
    ["ws", "tc"],
    ["tc", "nj"],
    ["nj", "lib"],
    ["ng", "nj"],
    ["wg", "tl"],
    ["lib", "tr"],
    ["tl", "nb"],
    ["nb", "bl"],
    ["tc", "c"],
    ["c", "bc"],
    ["tr", "br"],
    ["bl", "cot"],
    ["cot", "bc"],
    ["bc", "gt"],
    ["gt", "vlt"],
    ["vlt", "obs"],
    ["obs", "br"],
  ],
  spawn: "cot",
  hangouts: ["c", "nb", "cot", "tc", "wg", "ng", "obs", "lib", "gt"],
};
