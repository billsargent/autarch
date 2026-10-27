// The village: buildings, roads and scenery. Each building is a place the
// villagers walk to; buildings with a room open it, outdoor things (the notice
// board) open their dialogs in place, and the rest link to their Command
// Center page until their room is built.
import { shiftLayout, type Rect, type SceneLayout } from "../scene";

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

// The village as first laid out; VILLAGE_SCENE below moves it to make room
// for building plots to the north and west (#105).
const ORIGINAL: SceneLayout = {
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
    // The two empty buildings found a use (#144, #145), and the signposts give
    // directions (#146).
    { id: "storehouse", label: "Storehouse", role: "The village's stores, its treasury, and goods waiting for the cart", interior: "storehouse", door: "sh", parts: [{ stamp: "greenMarket", col: 9, row: 4 }] },
    { id: "postoffice", label: "Post office", role: "Your mail: drafts to approve, everything sent and why, your inbox and calendars", interior: "postoffice", door: "po", parts: [{ stamp: "fishShop", col: 24, row: 4 }] },
    { id: "signpost-west", label: "Signpost", role: "Directions: every place in the village, and who's there", door: "tl", action: "signs.directions", parts: [{ stamp: "svSignLeft", col: 2, row: 8 }] },
    { id: "signpost-east", label: "Signpost", role: "Directions: every place in the village, and who's there", door: "po", action: "signs.directions", parts: [{ stamp: "svSign", col: 26, row: 7 }] },
    // The market stall is the trading post (#136): orders from other towns.
    { id: "tradingpost", label: "Trading post", role: "Orders from the neighbouring towns, the village's stores and treasury", door: "nb", action: "trade.post", parts: [{ stamp: "marketStall", col: 9, row: 12 }] },
    { id: "home", label: "Your home", role: "Your own house: your computer, your desk, books and a guitar", interior: "home", door: "br", parts: [{ stamp: "beigeHouse", col: 35, row: 19 }] },
  ],
  // Scenery with no hotspot.
  decor: [
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
    { id: "sh", x: 11, y: 10 }, // the storehouse door
    { id: "po", x: 25.5, y: 10 }, // the post office door
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
    ["ws", "sh"],
    ["sh", "tc"],
    ["tc", "po"],
    ["po", "nj"],
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

// Land to the north and west (#105), in rings. Level 0 is the first ring: the
// village moved 7 tiles right and 6 down, the roads out of town carried on to
// the new edges, and four plots beside them, two along each road. Each level
// after that clears another ring (8 more columns west, 6 more rows north) with
// four more plots. The map is drawn once per level (npm run village:map); the
// village shows the level that's been cleared.
export const MAX_VILLAGE_LEVEL = 3;
const RING_ROWS = 6;
const ringCols = (r: number) => (r === 0 ? 7 : 8);

// The plot ids of one ring: the first ring keeps its original names.
export function ringPlotIds(r: number): string[] {
  return [`north-${2 * r + 1}`, `north-${2 * r + 2}`, `west-${2 * r + 1}`, `west-${2 * r + 2}`];
}

function villageAtLevel(level: number): SceneLayout {
  let dc = 0;
  for (let r = 0; r <= level; r++) dc += ringCols(r);
  const dr = RING_ROWS * (level + 1);
  const moved = shiftLayout(ORIGINAL, dc, dr);
  const roadCol = 27 + dc; // the north road
  const roadRow = 9 + dr; // the west road
  const NORTH_ROAD: Rect = { col: roadCol, row: 0, w: 2, h: dr };
  const WEST_ROAD: Rect = { col: 0, row: roadRow, w: dc, h: 2 };

  const plots: NonNullable<SceneLayout["plots"]> = [];
  const waypoints: SceneLayout["waypoints"] = [];
  const decor: SceneLayout["decor"] = [];
  const northChain: string[] = [];
  const westChain: string[] = [];
  let inner = 0;
  for (let r = 0; r <= level; r++) {
    const [n1, n2, w1, w2] = ringPlotIds(r);
    // Door waypoint ids: the first ring keeps its original ones.
    const ids = r === 0 ? ["nrl", "nrr", "wrt", "wrb"] : [`nr${r}l`, `nr${r}r`, `wr${r}t`, `wr${r}b`];
    const top = dr - RING_ROWS * (r + 1);
    const left = dc - inner - ringCols(r);
    inner += ringCols(r);
    plots.push(
      { id: n1, col: roadCol - 5, row: top + 1, w: 4, h: 4, door: ids[0] },
      { id: n2, col: roadCol + 3, row: top + 1, w: 4, h: 4, door: ids[1] },
      { id: w1, col: left + 1, row: roadRow - 5, w: 4, h: 4, door: ids[2] },
      { id: w2, col: left + 1, row: roadRow + 3, w: 4, h: 4, door: ids[3] },
    );
    waypoints.push(
      { id: ids[0], x: roadCol + 0.5, y: top + 3.5 },
      { id: ids[1], x: roadCol + 1.5, y: top + 3.5 },
      { id: ids[2], x: left + 3.5, y: roadRow + 0.4 },
      { id: ids[3], x: left + 3.5, y: roadRow + 1.6 },
    );
    // Outermost first, towards town.
    northChain.unshift(ids[0], ids[1]);
    westChain.unshift(ids[2], ids[3]);
    // Trees on the new land, clear of the plots and roads.
    if (r === 0) {
      const sx = dc - 7;
      const sy = dr - 6;
      decor.push(
        { stamp: "svTree", col: 10 + sx, row: 1 + sy },
        { stamp: "roundTree", col: 21 + sx, row: 2 + sy },
        { stamp: "pineTree", col: 44 + sx, row: 1 + sy },
        { stamp: "svTree", col: 1 + sx, row: 5 + sy },
        { stamp: "leafyTree", col: 1 + sx, row: 25 + sy },
      );
    } else {
      decor.push(
        { stamp: r % 2 ? "pineTree" : "svTree", col: roadCol - 13, row: top + 1 },
        { stamp: "roundTree", col: roadCol - 24, row: top + 2 },
        { stamp: r % 2 ? "leafyTree" : "pineTree", col: roadCol + 10, row: top + 1 },
        { stamp: "svTree", col: left + 2, row: roadRow + 10 },
      );
    }
  }
  // Each plot's sign is drawn live by the village (#146): clickable, and gone
  // once something is built there.

  return {
    ...moved,
    id: level === 0 ? "village" : `village-${level}`,
    paths: { ...moved.paths!, rects: [...moved.paths!.rects, NORTH_ROAD, WEST_ROAD] },
    walkable: [...moved.walkable, NORTH_ROAD, WEST_ROAD],
    decor: [...moved.decor, ...decor],
    waypoints: [
      // The gates move out to the new edges.
      ...moved.waypoints.map((w) => (w.id === "ng" ? { ...w, y: 0.6 } : w.id === "wg" ? { ...w, x: 0.6 } : w)),
      ...waypoints,
    ],
    edges: [
      ...moved.edges.filter(([a, b]) => !(a === "ng" && b === "nj") && !(a === "wg" && b === "tl")),
      ...["ng", ...northChain, "nj"].slice(1).map((b, i, arr) => [i === 0 ? "ng" : arr[i - 1], b] as const),
      ...["wg", ...westChain, "tl"].slice(1).map((b, i, arr) => [i === 0 ? "wg" : arr[i - 1], b] as const),
    ],
    plots,
  };
}

// Every level of the village, 0 (the first ring) to MAX_VILLAGE_LEVEL.
export const VILLAGE_LEVELS: SceneLayout[] = Array.from({ length: MAX_VILLAGE_LEVEL + 1 }, (_, l) => villageAtLevel(l));
export const VILLAGE_SCENE: SceneLayout = VILLAGE_LEVELS[0];
