import { CELL, SCALE, STAMPS, TILE, TILESETS, type StampId } from "./scene";

// One stamp from the tilesets, drawn live over a scene (buildings on the
// village's plots, #105) instead of baked into the scene's art.
export default function StampSprite({ stamp, x, y, opacity }: { stamp: StampId; x: number; y: number; opacity?: number }) {
  const st = STAMPS[stamp];
  const set = TILESETS[st.set];
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: x,
        top: y,
        width: st.w * CELL,
        height: st.h * CELL,
        opacity,
        backgroundImage: `url(/${set.image})`,
        backgroundSize: `${set.columns * TILE * SCALE}px ${set.rows * TILE * SCALE}px`,
        backgroundPosition: `-${st.col * CELL}px -${st.row * CELL}px`,
        imageRendering: "pixelated",
      }}
    />
  );
}
