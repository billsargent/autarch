// Copies villager looks from the Ninja Adventure pack (Pixel-boy and AAA,
// CC0) into public/village/characters/, and makes clothing-colour variants of
// the plainer villagers by swapping exact palette colours (never skin), and
// copies the animals into public/village/animals/.
// The pack is downloaded into the git-ignored assets-src/ (docs/village-art.md).
// Run with: npm run village:characters
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { CHARACTER_SOURCES, CHARACTER_VARIANTS } from "../src/lib/agent/villagerLooks";
import { ANIMAL_SHEETS } from "../src/components/village/Animals";

const PACK = path.join(process.cwd(), "assets-src", "ninja-adventure", "extracted", "Ninja Adventure - Asset Pack", "Actor", "Character");
const OUT = path.join(process.cwd(), "public", "village", "characters");

// Looks whose pack sheet is short (64×32).
const SHORT_SHEETS: Record<string, string> = { oldwoman: "OldWoman" };

const hex = (h: string) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];

async function main() {
  if (!fs.existsSync(PACK)) throw new Error(`The Ninja Adventure pack isn't in ${path.relative(process.cwd(), PACK)} (see docs/village-art.md).`);
  let n = 0;
  for (const [key, folder] of Object.entries(CHARACTER_SOURCES)) {
    const src = path.join(PACK, folder, "SpriteSheet.png");
    const meta = await sharp(src).metadata();
    if (meta.width !== 64 || meta.height !== 112) throw new Error(`${folder}: expected a 64×112 sheet, got ${meta.width}×${meta.height}`);
    fs.copyFileSync(src, path.join(OUT, `${key}.png`));
    n++;
  }
  // Short sheets (only two rows of frames) are filled out to the full layout by
  // repeating their rows, so walking never shows an empty frame.
  for (const [key, folder] of Object.entries(SHORT_SHEETS)) {
    const src = path.join(PACK, folder, "SpriteSheet.png");
    const meta = await sharp(src).metadata();
    const rows = Math.floor((meta.height ?? 0) / 16);
    const strips = await Promise.all(Array.from({ length: rows }, (_, r) => sharp(src).extract({ left: 0, top: r * 16, width: 64, height: 16 }).png().toBuffer()));
    await sharp({ create: { width: 64, height: 112, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(Array.from({ length: 7 }, (_, r) => ({ input: strips[r % rows], left: 0, top: r * 16 })))
      .png()
      .toFile(path.join(OUT, `${key}.png`));
    n++;
  }
  for (const [key, { base, swap }] of Object.entries(CHARACTER_VARIANTS)) {
    const { data, info } = await sharp(path.join(PACK, base, "SpriteSheet.png"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const map = new Map(Object.entries(swap).map(([from, to]) => [from.toLowerCase(), hex(to)]));
    for (let i = 0; i < data.length; i += 4) {
      const h = [data[i], data[i + 1], data[i + 2]].map((x) => x.toString(16).padStart(2, "0")).join("");
      const to = map.get(h);
      if (to) [data[i], data[i + 1], data[i + 2]] = to;
    }
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(path.join(OUT, `${key}.png`));
    n++;
  }
  // The animals (#138), as they are.
  const ANIMALS_IN = path.join(PACK, "..", "Animal");
  const ANIMALS_OUT = path.join(process.cwd(), "public", "village", "animals");
  fs.mkdirSync(ANIMALS_OUT, { recursive: true });
  for (const [kind, file] of Object.entries(ANIMAL_SHEETS)) {
    fs.copyFileSync(path.join(ANIMALS_IN, file), path.join(ANIMALS_OUT, `${kind}.png`));
    n++;
  }
  console.log(`wrote ${n} character and animal sheets to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
