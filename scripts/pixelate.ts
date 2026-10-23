// Snap AI-generated "pixel art" onto a true pixel grid (see docs/village-art.md).
// Downsamples to the art's real resolution, reduces the palette without
// dithering, optionally keys a background color to transparent, then scales
// back up with nearest-neighbor so every art pixel is a crisp square.
//
// Usage:
//   npm run pixelate -- <input> <output> --width 480 [--colors 48] [--scale 4] [--key ff00ff]
//
//   --width   width of the art in real pixels (e.g. 480 for a 1920px map at 4×)
//   --colors  palette size after quantizing (default 48)
//   --scale   upscale factor for the output (default: input width / --width)
//   --key     hex color to make transparent, e.g. ff00ff for sprite sheets
import type { Sharp } from "sharp";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const [input, output] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  const width = Number(arg("width"));
  if (!input || !output || !width) {
    console.error("Usage: npm run pixelate -- <input> <output> --width <px> [--colors 48] [--scale 4] [--key ff00ff]");
    process.exit(1);
  }
  const colors = Number(arg("colors") ?? 48);
  const key = arg("key");

  let sharp: (input?: string | Buffer, options?: object) => Sharp;
  try {
    sharp = (await import("sharp")).default as unknown as typeof sharp;
  } catch {
    console.error("This script needs the 'sharp' package (installed with Next.js). Run npm install first.");
    process.exit(1);
  }

  const meta = await sharp(input).metadata();
  const scale = Number(arg("scale") ?? Math.max(1, Math.round((meta.width ?? width) / width)));

  // 1. Downsample to the real art resolution (area-style averaging).
  const small = await sharp(input).resize({ width, kernel: "mitchell" }).png().toBuffer();
  // 2. Reduce the palette with no dithering so flat areas stay flat.
  const quantized = await sharp(small).png({ palette: true, colours: colors, dither: 0 }).toBuffer();
  // 3. Optionally key out the background color.
  const { data, info } = await sharp(quantized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (key) {
    const [kr, kg, kb] = [0, 2, 4].map((i) => parseInt(key.slice(i, i + 2), 16));
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - kr) + Math.abs(data[i + 1] - kg) + Math.abs(data[i + 2] - kb) < 60) data[i + 3] = 0;
    }
  }
  // 4. Scale back up with nearest-neighbor.
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize({ width: info.width * scale, kernel: "nearest" })
    .png()
    .toFile(output);

  console.log(`${input} → ${output}: ${info.width}×${info.height} art pixels, ${colors} colors, ×${scale}${key ? `, #${key} transparent` : ""}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
