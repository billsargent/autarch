// Builds the art for every scene in src/components/village/scenes/:
//   public/village/scenes/<id>.png  — the image the view shows (3× scale)
//   public/village/scenes/<id>.tmj  — the same scene as a Tiled map, for looking around
// Run with: npm run village:map
//
// Layers, bottom to top: the fill (with weighted variants), repeated areas
// (floors, wall strips), ground stamps (wall pieces, windows, rugs), paths
// (edges picked from neighbours), then places, scenery and scattered flowers,
// drawn top-to-bottom so taller things overlap correctly.
import fs from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import {
  STAMPS,
  SCALE,
  TILE,
  TILESETS,
  isPath,
  objectPlacements,
  stampRect,
  validateScene,
  validateStamps,
  type Placement,
  type Rect,
  type StampId,
  type SceneLayout,
  type TilesetId,
} from "../src/components/village/scene";
import { ALL_SCENES } from "../src/components/village/scenes";

const PUBLIC = path.join(process.cwd(), "public");
const OUT_DIR = path.join(PUBLIC, "village", "scenes");

// Small seeded PRNG so every build of a scene is identical.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TileRef {
  set: TilesetId;
  col: number;
  row: number;
}

const sources = new Map<TilesetId, Buffer>();
const cache = new Map<string, Buffer>();
async function cut(set: TilesetId, col: number, row: number, w = 1, h = 1): Promise<Buffer> {
  const key = `${set}:${col},${row},${w}x${h}`;
  let buf = cache.get(key);
  if (!buf) {
    if (!sources.has(set)) sources.set(set, await fs.promises.readFile(path.join(PUBLIC, TILESETS[set].image)));
    buf = await sharp(sources.get(set)!)
      .extract({ left: col * TILE, top: row * TILE, width: w * TILE, height: h * TILE })
      .png()
      .toBuffer();
    cache.set(key, buf);
  }
  return buf;
}

// Which edge/corner of a 3×3 path blob a path tile needs, from whether each
// neighbour is off the path. Off the map counts as path, so roads that reach
// the edge look like they carry on out of town.
function pathTile(scene: SceneLayout, col: number, row: number): TileRef {
  return blobTile(scene, scene.paths!.blob, (c, r) => isPath(scene, c, r), col, row);
}

// Water (#190): the same, over the water's rectangles.
const inRects = (rects: Rect[], c: number, r: number) => rects.some((x) => c >= x.col && c < x.col + x.w && r >= x.row && r < x.row + x.h);

function blobTile(scene: SceneLayout, blobId: StampId, isOn: (c: number, r: number) => boolean, col: number, row: number): TileRef {
  const blob = STAMPS[blobId];
  const on = (c: number, r: number) => c < 0 || r < 0 || c >= scene.cols || r >= scene.rows || isOn(c, r);
  const offN = !on(col, row - 1);
  const offS = !on(col, row + 1);
  const offW = !on(col - 1, row);
  const offE = !on(col + 1, row);
  const x = offW && !offE ? 0 : offE && !offW ? 2 : 1;
  const y = offN && !offS ? 0 : offS && !offN ? 2 : 1;
  return { set: blob.set, col: blob.col + x, row: blob.row + y };
}

async function buildScene(scene: SceneLayout) {
  const random = rng(scene.scatter?.seed ?? 1);
  const { cols, rows } = scene;
  const layers: OverlayOptions[] = [];
  // Tiled export: one grid for the floor, one for everything placed on it.
  const ground: Array<Array<TileRef | null>> = Array.from({ length: rows }, () => Array(cols).fill(null));
  const objects: Array<Array<TileRef | null>> = Array.from({ length: rows }, () => Array(cols).fill(null));

  const put = async (grid: Array<Array<TileRef | null>>, p: Placement) => {
    const st = STAMPS[p.stamp];
    layers.push({ input: await cut(st.set, st.col, st.row, st.w, st.h), left: p.col * TILE, top: p.row * TILE });
    for (let dx = 0; dx < st.w; dx++) {
      for (let dy = 0; dy < st.h; dy++) {
        if (grid[p.row + dy]?.[p.col + dx] !== undefined) grid[p.row + dy][p.col + dx] = { set: st.set, col: st.col + dx, row: st.row + dy };
      }
    }
  };

  // 1. Fill and paths, one tile at a time.
  const total = scene.fill.reduce((sum, f) => sum + f.weight, 0);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let ref: TileRef;
      if (scene.water && inRects(scene.water.rects, col, row)) {
        ref = blobTile(scene, scene.water.blob, (c, r) => inRects(scene.water!.rects, c, r), col, row);
      } else if (isPath(scene, col, row)) {
        ref = pathTile(scene, col, row);
      } else {
        let r = random() * total;
        const pick = scene.fill.find((f) => (r -= f.weight) < 0) ?? scene.fill[scene.fill.length - 1];
        const st = STAMPS[pick.stamp];
        ref = { set: st.set, col: st.col, row: st.row };
      }
      ground[row][col] = ref;
      layers.push({ input: await cut(ref.set, ref.col, ref.row), left: col * TILE, top: row * TILE });
    }
  }

  // 2. Repeated areas and ground stamps.
  for (const a of scene.areas ?? []) {
    for (let row = a.rect.row; row < a.rect.row + a.rect.h; row++) {
      for (let col = a.rect.col; col < a.rect.col + a.rect.w; col++) await put(ground, { stamp: a.stamp, col, row });
    }
  }
  for (const g of scene.ground ?? []) await put(ground, g);

  // 3. Everything standing on the ground, plus scattered flowers on free fill.
  const placements: Placement[] = objectPlacements(scene).map((o) => o.p);
  if (scene.scatter) {
    const taken = new Set<string>();
    for (const p of placements) {
      const r = stampRect(p);
      for (let c = r.col - 1; c <= r.col + r.w; c++) for (let rw = r.row; rw <= r.row + r.h; rw++) taken.add(`${c},${rw}`);
    }
    const wanted = placements.length + scene.scatter.count;
    let tries = 0;
    while (placements.length < wanted && tries++ < 5000) {
      const col = Math.floor(random() * cols);
      const row = Math.floor(random() * rows);
      if (isPath(scene, col, row) || (scene.water && inRects(scene.water.rects, col, row)) || taken.has(`${col},${row}`)) continue;
      taken.add(`${col},${row}`);
      placements.push({ stamp: scene.scatter.stamps[Math.floor(random() * scene.scatter.stamps.length)], col, row });
    }
  }
  placements.sort((a, b) => stampRect(a).row + stampRect(a).h - (stampRect(b).row + stampRect(b).h) || a.col - b.col);
  for (const p of placements) await put(objects, p);

  // 4. Compose at 1×, then scale up with nearest-neighbour for crisp pixels.
  const width = cols * TILE;
  const height = rows * TILE;
  const base = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
  const outPng = path.join(OUT_DIR, `${scene.id}.png`);
  await sharp(base).resize({ width: width * SCALE, kernel: "nearest" }).png({ compressionLevel: 9 }).toFile(outPng);

  // 5. Tiled map (same layers), referencing the committed tilesets.
  let firstgid = 1;
  const tilesets = (Object.entries(TILESETS) as Array<[TilesetId, (typeof TILESETS)[TilesetId]]>).map(([id, set]) => {
    const entry = {
      firstgid,
      name: id,
      image: path.posix.relative("village/scenes", set.image),
      imagewidth: set.columns * TILE,
      imageheight: set.rows * TILE,
      tilewidth: TILE,
      tileheight: TILE,
      columns: set.columns,
      tilecount: set.columns * set.rows,
      margin: 0,
      spacing: 0,
    };
    firstgid += set.columns * set.rows;
    return entry;
  });
  const gid = (t: TileRef | null) => {
    if (!t) return 0;
    const ts = tilesets.find((x) => x.name === t.set)!;
    return ts.firstgid + t.row * ts.columns + t.col;
  };
  const layer = (id: number, name: string, grid: Array<Array<TileRef | null>>) => ({
    id,
    name,
    type: "tilelayer",
    x: 0,
    y: 0,
    width: cols,
    height: rows,
    opacity: 1,
    visible: true,
    data: grid.flat().map(gid),
  });
  const tmj = {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    width: cols,
    height: rows,
    tilewidth: TILE,
    tileheight: TILE,
    infinite: false,
    nextlayerid: 3,
    nextobjectid: 1,
    tilesets,
    layers: [layer(1, "Floor", ground), layer(2, "Objects", objects)],
  };
  await fs.promises.writeFile(path.join(OUT_DIR, `${scene.id}.tmj`), JSON.stringify(tmj));
  console.log(`  ${scene.id}: ${width * SCALE}×${height * SCALE}`);
}

async function main() {
  const problems = [...validateStamps(), ...ALL_SCENES.flatMap(validateScene)];
  if (problems.length) {
    console.error("Scene problems:\n" + problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  console.log(`Writing ${path.relative(process.cwd(), OUT_DIR)}/`);
  for (const scene of ALL_SCENES) await buildScene(scene);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
