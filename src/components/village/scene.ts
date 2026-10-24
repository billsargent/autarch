// Scenes: the village and every building interior, described in tile units.
// Each scene file in scenes/ drives both the art (scripts/build-village-map.ts
// composes public/village/scenes/<id>.png from it) and the hotspots the view
// uses (manifest.ts derives them), so art and clickable areas never drift.
// Pure data and helpers: no React, no DOM.
//
// Art: "Serene Village" by LimeZu (CC BY 4.0) and "Ninja Adventure" by
// Pixel-boy & AAA (CC0). See public/village/CREDITS.md.

export const TILE = 16; // source pixels per tile
export const SCALE = 3; // tiles are drawn 3× (48 px)
export const CELL = TILE * SCALE;

export interface Tileset {
  // Path under public/.
  image: string;
  columns: number;
  rows: number;
}

export const TILESETS = {
  sv: { image: "village/tiles/serene-village-outside.png", columns: 8, rows: 27 },
  svInside: { image: "village/tiles/serene-village-inside.png", columns: 9, rows: 20 },
  house: { image: "village/tiles/ninja-house.png", columns: 33, rows: 23 },
  element: { image: "village/tiles/ninja-element.png", columns: 16, rows: 15 },
  nature: { image: "village/tiles/ninja-nature.png", columns: 24, rows: 21 },
  floor: { image: "village/tiles/ninja-floor.png", columns: 22, rows: 17 },
  wall: { image: "village/tiles/ninja-wall.png", columns: 10, rows: 11 },
  camp: { image: "village/tiles/ninja-camp.png", columns: 23, rows: 9 },
  bed: { image: "village/tiles/ninja-bed.png", columns: 14, rows: 12 },
  // Drawn for this project (scripts/build-custom-tiles.ts).
  custom: { image: "village/tiles/autarch-custom.png", columns: 8, rows: 3 },
} as const satisfies Record<string, Tileset>;

export type TilesetId = keyof typeof TILESETS;

// A rectangle of tiles cut from a tileset.
export interface Stamp {
  set: TilesetId;
  col: number;
  row: number;
  w: number;
  h: number;
}

const s = (set: TilesetId, col: number, row: number, w = 1, h = 1): Stamp => ({ set, col, row, w, h });

export const STAMPS = {
  // Serene Village — outside
  svGrass: s("sv", 1, 2),
  svGrassTuft: s("sv", 0, 1),
  svGrassTuft2: s("sv", 1, 1),
  svPathBlob: s("sv", 2, 0, 3, 3), // 3×3 path edges/corners
  svPond: s("sv", 5, 0, 3, 3),
  svTree: s("sv", 0, 5, 2, 3),
  svFlowersPatch: s("sv", 0, 3, 2, 2),
  svFlowerRed: s("sv", 2, 5),
  svFlowerBig: s("sv", 3, 5),
  svFlowerTeal: s("sv", 4, 5),
  svFlowerTeal2: s("sv", 2, 6),
  svBush: s("sv", 3, 6),
  svNoticeBoard: s("sv", 5, 5, 1, 2),
  svSign: s("sv", 6, 5),
  svSignLeft: s("sv", 6, 7),
  svMailbox: s("sv", 5, 8, 1, 2),
  svHouseRed: s("sv", 0, 10, 4, 4),
  svHouseRedBig: s("sv", 0, 14, 5, 4),
  svHouseBlue: s("sv", 0, 18, 4, 4),
  svHouseBlueBig: s("sv", 0, 22, 5, 4),
  // Serene Village — inside
  wallCap: s("svInside", 3, 0),
  wallPlaster: s("svInside", 3, 1),
  wallBrick: s("svInside", 3, 2),
  windowRed: s("svInside", 5, 3, 2, 2),
  windowBlue: s("svInside", 5, 5, 2, 2),
  bookshelf: s("svInside", 4, 12, 2, 2),
  writingDesk: s("svInside", 2, 12, 2, 2),
  readingTable: s("svInside", 2, 14, 2, 2),
  chairRed: s("svInside", 4, 14),
  chairBlue: s("svInside", 6, 14),
  pottedPlant: s("svInside", 0, 12),
  bigRug: s("svInside", 6, 11, 3, 3),
  doormat: s("svInside", 4, 8, 2, 1),
  painting: s("svInside", 5, 9),
  // Ninja Adventure — village
  hall: s("house", 25, 7, 4, 7),
  barn: s("house", 25, 14, 4, 5),
  lookout: s("house", 16, 6, 3, 5),
  dome: s("house", 29, 4, 3, 4),
  stoneHouse: s("house", 23, 0, 3, 3),
  fishShop: s("house", 16, 0, 3, 3),
  greenMarket: s("house", 19, 0, 4, 3),
  beigeHouse: s("house", 4, 0, 4, 3),
  marketStall: s("house", 16, 16, 3, 2),
  barrel: s("house", 16, 15),
  produceCrate: s("house", 19, 14),
  lampPost: s("element", 6, 3, 1, 2),
  roundTree: s("nature", 0, 0, 2, 2),
  pineTree: s("nature", 2, 0, 2, 2),
  leafyTree: s("nature", 16, 0, 2, 2),
  // Ninja Adventure — interiors
  tallBookshelf: s("element", 8, 7, 2, 2),
  jobBoard: s("element", 11, 1, 3, 1), // a standing board with written slips
  workbench: s("element", 2, 10, 3, 1),
  toolShelf: s("element", 10, 7, 2, 2),
  grindstone: s("element", 0, 10),
  scrapPile: s("element", 1, 10),
  lumber: s("element", 10, 2),
  plankStack: s("element", 9, 2),
  stump: s("element", 8, 2),
  ropeCoil: s("element", 8, 3),
  sack: s("element", 0, 1),
  sackOpen: s("element", 1, 1),
  barrelBands: s("element", 4, 0),
  chest: s("element", 3, 1),
  handcart: s("element", 2, 3, 2, 2),
  drawers: s("element", 1, 7, 1, 2),
  darkDresser: s("element", 6, 7, 2, 2),
  emptyShelf: s("element", 10, 7, 2, 2),
  smallChest: s("element", 1, 9),
  clayPot: s("element", 2, 9),
  redBanner: s("element", 9, 9, 2, 1),
  mapPainting: s("element", 8, 10),
  stoneFloor: s("floor", 12, 13),
  cobbleFloor: s("floor", 2, 13),
  // Ninja Adventure — camp
  starChart: s("camp", 10, 5, 2, 2),
  roundTable: s("camp", 1, 5, 2, 2),
  logBench: s("camp", 0, 7, 3, 1),
  lanternPost: s("camp", 6, 5, 1, 2),
  bannerPost: s("camp", 7, 5, 1, 2),
  bigBarrel: s("camp", 4, 6, 2, 2),
  crateSmall: s("camp", 3, 7),
  campChest: s("camp", 4, 8),
  campChest2: s("camp", 5, 8),
  book: s("camp", 7, 8),
  candle: s("camp", 13, 7),
  stumpSeat: s("camp", 3, 5),
  hearth: s("camp", 12, 5, 2, 2),
  // Ninja Adventure — beds
  bedRed: s("bed", 0, 3, 2, 3),
  bedBlueSingle: s("bed", 12, 3, 1, 2),
  // Drawn for this project: the owner's home (#110)
  computerDesk: s("custom", 0, 0, 2, 2),
  guitar: s("custom", 2, 0, 1, 2),
  wallCalendar: s("custom", 3, 0),
  // The village farm's wheat field (#106).
  wheatField: s("custom", 4, 0, 4, 3),
  plankFloor: s("floor", 17, 4),
  rimCornerBL: s("wall", 5, 4),
  rimCornerBR: s("wall", 9, 4),
  rimLeft: s("wall", 5, 1),
  rimRight: s("wall", 9, 1),
  rimBottom: s("wall", 8, 4),
  rimBottomEndRight: s("wall", 6, 4), // rounded end on its right side
  rimBottomEndLeft: s("wall", 7, 4), // rounded end on its left side
} as const satisfies Record<string, Stamp>;

export type StampId = keyof typeof STAMPS;

export interface Placement {
  stamp: StampId;
  col: number;
  row: number;
}

export interface Rect {
  col: number;
  row: number;
  w: number;
  h: number;
}

// A clickable place: a building in the village, or furniture in a room.
export interface PlaceDef {
  id: string;
  label: string;
  role: string;
  // Waypoint a villager walks to when visiting.
  door: string;
  parts: Placement[];
  // Village buildings: the room it opens (a scene id) or, until that room
  // exists, the page it links to.
  interior?: string;
  href?: string;
  // Room furniture: what clicking it does (handled by the room's view).
  action?: string;
}

export interface SceneLayout {
  id: string;
  title: string;
  cols: number;
  rows: number;
  // Base layer, filled everywhere first (weighted variants).
  fill: Array<{ stamp: StampId; weight: number }>;
  // A 1×1 stamp repeated over rectangles (floors, wall strips).
  areas?: Array<{ rect: Rect; stamp: StampId }>;
  // Ground-level stamps over the fill: wall pieces, windows, rugs. Not clickable.
  ground?: Placement[];
  // Paths drawn with edges picked from their neighbours.
  paths?: { rects: Rect[]; blob: StampId };
  places: PlaceDef[];
  decor: Placement[];
  lamps: Placement[];
  // Flowers and the like, scattered on free fill tiles at build time.
  scatter?: { stamps: StampId[]; count: number; seed: number };
  // Where waypoints may sit (roads outside, the floor inside).
  walkable: Rect[];
  // Waypoints in tile units (may be fractional) and the graph between them.
  // `onFurniture`: meant to be on top of something (a bed, #111), so it may
  // sit under a stamp.
  waypoints: Array<{ id: string; x: number; y: number; onFurniture?: boolean }>;
  edges: Array<readonly [string, string]>;
  spawn: string;
  // Interiors: the waypoint by the way out.
  exit?: string;
  // Waypoints idle villagers wander between in the daytime.
  hangouts?: string[];
  // Empty building plots (#105): what gets built there is drawn over the
  // scene at run time, so the art doesn't change.
  plots?: Plot[];
}

export interface Plot {
  id: string;
  col: number;
  row: number;
  w: number;
  h: number;
  // The waypoint by its gate.
  door: string;
}

// The same layout moved `dc` columns right and `dr` rows down, on a map that
// much bigger: room for new land along the top and left edges (#105).
export function shiftLayout(layout: SceneLayout, dc: number, dr: number): SceneLayout {
  const r = <T extends { col: number; row: number }>(x: T): T => ({ ...x, col: x.col + dc, row: x.row + dr });
  return {
    ...layout,
    cols: layout.cols + dc,
    rows: layout.rows + dr,
    areas: layout.areas?.map((a) => ({ ...a, rect: r(a.rect) })),
    ground: layout.ground?.map(r),
    paths: layout.paths && { ...layout.paths, rects: layout.paths.rects.map(r) },
    places: layout.places.map((p) => ({ ...p, parts: p.parts.map(r) })),
    decor: layout.decor.map(r),
    lamps: layout.lamps.map(r),
    walkable: layout.walkable.map(r),
    waypoints: layout.waypoints.map((w) => ({ ...w, x: w.x + dc, y: w.y + dr })),
    plots: layout.plots?.map(r),
  };
}

// --- helpers ---------------------------------------------------------------

export function stampRect(p: Placement): Rect {
  const st = STAMPS[p.stamp];
  return { col: p.col, row: p.row, w: st.w, h: st.h };
}

export function unionRect(rects: Rect[]): Rect {
  const c0 = Math.min(...rects.map((r) => r.col));
  const r0 = Math.min(...rects.map((r) => r.row));
  const c1 = Math.max(...rects.map((r) => r.col + r.w));
  const r1 = Math.max(...rects.map((r) => r.row + r.h));
  return { col: c0, row: r0, w: c1 - c0, h: r1 - r0 };
}

export function inRects(rects: Rect[], col: number, row: number): boolean {
  return rects.some((r) => col >= r.col && col < r.col + r.w && row >= r.row && row < r.row + r.h);
}

export function isPath(scene: SceneLayout, col: number, row: number): boolean {
  return Boolean(scene.paths) && inRects(scene.paths!.rects, col, row);
}

// Every stamp that stands on the ground (clickable or not), in one list.
export function objectPlacements(scene: SceneLayout): Array<{ owner: string; p: Placement }> {
  return [
    ...scene.places.flatMap((pl) => pl.parts.map((p) => ({ owner: pl.id, p }))),
    ...scene.decor.map((p, i) => ({ owner: `decor#${i}`, p })),
    ...scene.lamps.map((p, i) => ({ owner: `lamp#${i}`, p })),
  ];
}

// Stamps that point outside their tileset. Checked once for all scenes.
export function validateStamps(): string[] {
  const problems: string[] = [];
  for (const [id, st] of Object.entries(STAMPS)) {
    const set = TILESETS[st.set];
    if (st.col < 0 || st.row < 0 || st.col + st.w > set.columns || st.row + st.h > set.rows) {
      problems.push(`stamp ${id} lies outside tileset ${st.set}`);
    }
  }
  return problems;
}

// Problems with one scene, or [] if it's consistent.
export function validateScene(scene: SceneLayout): string[] {
  const problems: string[] = [];
  const where = (msg: string) => problems.push(`${scene.id}: ${msg}`);
  const inside = (r: Rect) => r.col >= 0 && r.row >= 0 && r.col + r.w <= scene.cols && r.row + r.h <= scene.rows;

  for (const a of scene.areas ?? []) if (!inside(a.rect)) where(`area of ${a.stamp} lies outside the map`);
  for (const g of scene.ground ?? []) if (!inside(stampRect(g))) where(`ground ${g.stamp} lies outside the map`);
  for (const r of scene.walkable) if (!inside(r)) where("a walkable area lies outside the map");

  const wpCells = new Set(scene.waypoints.filter((w) => !w.onFurniture).map((w) => `${Math.floor(w.x)},${Math.floor(w.y)}`));
  const occupied = new Map<string, string>();
  for (const { owner, p } of objectPlacements(scene)) {
    const r = stampRect(p);
    if (!inside(r)) where(`${owner} (${p.stamp}) lies outside the map`);
    for (let c = r.col; c < r.col + r.w; c++) {
      for (let row = r.row; row < r.row + r.h; row++) {
        const key = `${c},${row}`;
        if (isPath(scene, c, row)) where(`${owner} (${p.stamp}) covers path tile ${key}`);
        if (wpCells.has(key)) where(`${owner} (${p.stamp}) covers a waypoint at ${key}`);
        const prev = occupied.get(key);
        if (prev) where(`${owner} (${p.stamp}) overlaps ${prev} at ${key}`);
        occupied.set(key, owner);
      }
    }
  }

  const ids = new Set(scene.waypoints.map((w) => w.id));
  for (const w of scene.waypoints) {
    if (!inRects(scene.walkable, Math.floor(w.x), Math.floor(w.y))) where(`waypoint ${w.id} is not on walkable ground`);
  }
  for (const [a, b] of scene.edges) if (!ids.has(a) || !ids.has(b)) where(`edge ${a}-${b} has an unknown waypoint`);
  for (const pl of scene.places) if (!ids.has(pl.door)) where(`place ${pl.id} door ${pl.door} is not a waypoint`);
  if (!ids.has(scene.spawn)) where(`spawn ${scene.spawn} is not a waypoint`);
  if (scene.exit && !ids.has(scene.exit)) where(`exit ${scene.exit} is not a waypoint`);
  return problems;
}
