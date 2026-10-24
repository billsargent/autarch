// Builds public/village/tiles/autarch-custom.png: furniture the art packs
// don't have, drawn here pixel by pixel in their style (16 px tiles):
//   cols 0–1, rows 0–1  computer desk: the Serene Village writing desk with a
//                       monitor full of code, a keyboard, a mouse and a mug
//   col 2,    rows 0–1  an acoustic guitar
//   col 3,    row 0     a wall calendar
//   cols 4–7, rows 0–2  a wheat field with a fence (the village farm, #106)
//   cols 8–11, rows 0–2 a flower garden in a hedge (the village garden)
// The pixels are this project's own; the desk underneath is from "Serene
// Village" by LimeZu (CC BY 4.0). See public/village/CREDITS.md.
// Run with: npm run village:custom-art (then npm run village:map).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const PUBLIC = path.join(process.cwd(), "public");
const OUT = path.join(PUBLIC, "village", "tiles", "autarch-custom.png");
const W = 192;
const H = 48;

type RGBA = [number, number, number, number];
const PALETTE: Record<string, RGBA> = {
  O: [43, 36, 36, 255], // outline
  F: [88, 92, 104, 255], // monitor frame
  K: [27, 36, 62, 255], // screen
  G: [110, 220, 140, 255], // code: green
  P: [240, 120, 170, 255], // code: pink
  Y: [243, 237, 132, 255], // code: yellow
  W: [222, 224, 230, 255], // keys, mug
  k: [150, 152, 160, 255], // key gaps
  C: [96, 58, 34, 255], // coffee
  H: [92, 56, 30, 255], // guitar head
  p: [226, 196, 110, 255], // tuning pegs
  N: [128, 80, 42, 255], // neck
  S: [236, 232, 214, 255], // strings
  B: [206, 138, 66, 255], // guitar body
  L: [238, 182, 104, 255], // body highlight
  D: [54, 32, 20, 255], // sound hole
  g: [70, 44, 26, 255], // bridge
  R: [196, 64, 54, 255], // calendar band, today
  s: [122, 84, 48, 255], // soil
  t: [96, 64, 36, 255], // soil furrow
  h: [228, 196, 92, 255], // wheat
  j: [250, 226, 128, 255], // wheat highlight
  q: [176, 140, 60, 255], // wheat stalk
  f: [150, 104, 60, 255], // fence
  z: [110, 74, 42, 255], // fence post
  w: [250, 246, 236, 255], // paper
  e: [58, 112, 52, 255], // hedge
  E: [86, 148, 70, 255], // hedge highlight
  a: [206, 184, 140, 255], // gravel path
  A: [182, 158, 116, 255], // gravel speck
  l: [92, 160, 76, 255], // leaves
  r: [226, 84, 96, 255], // flowers: red
  y: [246, 210, 80, 255], // flowers: yellow
  v: [168, 120, 220, 255], // flowers: violet
  c: [250, 250, 250, 255], // flower centres
};

// Rows of pixels, drawn with their top-left at (x, y); "." is see-through.
const COMPUTER = {
  x: 8,
  y: 0,
  rows: [
    "OOOOOOOOOOOOOOOO",
    "OFFFFFFFFFFFFFFO",
    "OFKKKKKKKKKKKKFO",
    "OFKGGGKYYKKKKKFO",
    "OFKKPPPPKGGGKKFO",
    "OFKKKGGGGGKKKKFO",
    "OFKYYKKPPPKKKKFO",
    "OFKKKKGGGGGGKKFO",
    "OFKGGKKKKKKKKKFO",
    "OFFFFFFFFFFFFFFO",
    "OOOOOOOOOOOOOOOO",
    "......OFFO......",
    "....OOFFFFOO....",
    "....OOOOOOOO....",
  ],
};
const KEYBOARD = {
  x: 6,
  y: 15,
  rows: [
    "OOOOOOOOOOOOOO..OO",
    "OWkWkWkWkWkWkO..WW",
    "OOOOOOOOOOOOOO..OO",
  ],
};
const MUG = {
  x: 25,
  y: 12,
  rows: ["OOO.", "OCO.", "OWOO", "OWO.", "OOO."],
};
const GUITAR = {
  x: 32,
  y: 0,
  rows: [
    "......OOOO......",
    ".....pHHHHp.....",
    ".....OHHHHO.....",
    ".....pHHHHp.....",
    "......OHHO......",
    "......ONNO......",
    "......ONSO......",
    "......ONSO......",
    "......ONSO......",
    "......ONSO......",
    "......ONSO......",
    "......ONSO......",
    "......ONSO......",
    "......ONSO......",
    "....OOONSOOO....",
    "...OLLBNSBBBO...",
    "..OLLBBNSBBBBO..",
    "..OLBBBNSBBBBO..",
    "...OBBBNSBBBO...",
    "....OBBNSBBO....",
    "...OBBBDDBBBO...",
    "..OLBBDDDDBBBO..",
    ".OLBBBDDDDBBBBO.",
    ".OLBBBBDDBBBBBO.",
    ".OLBBBBNSBBBBBO.",
    ".OLBBBBBBBBBBBO.",
    ".OLBBBggggBBBBO.",
    ".OBBBBBBBBBBBBO.",
    "..OBBBBBBBBBBO..",
    "...OBBBBBBBBO...",
    "....OOOOOOOO....",
    "................",
  ],
};
const CALENDAR = {
  x: 48,
  y: 0,
  rows: [
    "................",
    "...OOOOOOOOOO...",
    "...ORRRRRRRRO...",
    "...ORRwwwwRRO...",
    "...OwwwwwwwwO...",
    "...OwkwkwkwkO...",
    "...OwwwwwwwwO...",
    "...OwkwkwRwkO...",
    "...OwwwwwwwwO...",
    "...OwkwkwkwkO...",
    "...OwwwwwwwwO...",
    "...OOOOOOOOOO...",
  ],
};

// The wheat field: a fence round the edge, furrows of soil and rows of
// wheat, drawn by rule rather than by hand (64×48).
function wheatField(buf: Buffer, x0: number, y0: number) {
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 64; x++) {
      let ch: string;
      const edge = x < 2 || x > 61 || y < 3 || y > 45;
      if (edge) ch = (x % 8 === 0 || x === 63) && (y < 3 || y > 45) ? "z" : y === 1 || y === 46 || x === 0 || x === 63 ? "f" : ".";
      else if (y % 6 === 5) ch = "t";
      else if (y % 6 >= 1 && (x + Math.floor(y / 6)) % 3 !== 0) ch = y % 6 === 1 && x % 3 === 1 ? "j" : y % 6 >= 3 ? "q" : "h";
      else ch = "s";
      if (ch === ".") continue;
      buf.set(PALETTE[ch], ((y0 + y) * W + x0 + x) * 4);
    }
  }
}

// The garden: a hedge round the edge, a gravel cross of paths and four beds
// of flowers, drawn by rule like the wheat field (64×48).
function garden(buf: Buffer, x0: number, y0: number) {
  const flowers = ["r", "y", "v", "r"];
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 64; x++) {
      let ch: string;
      const hedge = x < 3 || x > 60 || y < 3 || y > 44;
      // The gap in the hedge at the bottom is the way in.
      const gate = y > 44 && x >= 28 && x < 36;
      if (hedge && !gate) ch = (x + y) % 5 === 0 ? "E" : "e";
      else if ((x >= 28 && x < 36) || (y >= 21 && y < 27)) ch = (x * 7 + y * 3) % 11 === 0 ? "A" : "a";
      else {
        const bed = (x < 32 ? 0 : 1) + (y < 24 ? 0 : 2);
        const fx = x % 6;
        const fy = y % 6;
        if (fx >= 2 && fx <= 4 && fy >= 1 && fy <= 3) ch = fx === 3 && fy === 2 ? "c" : flowers[(bed + Math.floor(x / 6) + Math.floor(y / 6)) % 4];
        else ch = "l";
      }
      buf.set(PALETTE[ch], ((y0 + y) * W + x0 + x) * 4);
    }
  }
}

function draw(buf: Buffer, art: { x: number; y: number; rows: string[] }) {
  art.rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      if (ch === ".") return;
      const color = PALETTE[ch];
      if (!color) throw new Error(`no colour for "${ch}"`);
      const i = ((art.y + dy) * W + art.x + dx) * 4;
      buf.set(color, i);
    });
  });
}

async function main() {
  const canvas = Buffer.alloc(W * H * 4);
  // The writing desk (Serene Village inside, cols 2–3, rows 12–13).
  const desk = await sharp(path.join(PUBLIC, "village", "tiles", "serene-village-inside.png"))
    .extract({ left: 32, top: 192, width: 32, height: 32 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let y = 0; y < 32; y++) desk.copy(canvas, y * W * 4, y * 32 * 4, (y + 1) * 32 * 4);
  for (const art of [COMPUTER, KEYBOARD, MUG, GUITAR, CALENDAR]) draw(canvas, art);
  wheatField(canvas, 64, 0);
  garden(canvas, 128, 0);
  await sharp(canvas, { raw: { width: W, height: H, channels: 4 } }).png().toFile(OUT);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
