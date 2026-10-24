"use client";

import { useEffect, useState } from "react";
import { CELL, SCALE, TILE } from "./scene";

// Animals that make the village feel lived in (#138): Ninja Adventure's
// two-frame idle sheets (16 px frames, CC0), each wandering slowly inside an
// area of the scene. No names, no clicks; they're scenery that moves.

export const ANIMAL_SHEETS = {
  cat: "Cat/SpriteSheet.png",
  dog: "Dog/SpriteSheet.png",
  "chicken-white": "Chicken/SpriteSheetWhite.png",
  "chicken-brown": "Chicken/SpriteSheetBrown.png",
  cow: "Cow/SpriteSheetWhite.png",
  horse: "Horse/SpriteSheetBrown.png",
} as const;
export type AnimalKind = keyof typeof ANIMAL_SHEETS;

// An area in scene px.
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface AnimalSpec {
  id: string;
  kind: AnimalKind;
  area: Area;
}

const SIZE = TILE * SCALE;

// A point inside the area, leaving room for the sprite.
function spot(a: Area, r: () => number) {
  return { x: a.x + r() * Math.max(0, a.w - SIZE), y: a.y + r() * Math.max(0, a.h - SIZE) };
}

function Animal({ spec }: { spec: AnimalSpec }) {
  const [pos, setPos] = useState(() => spot(spec.area, () => 0.5));
  const [facingLeft, setFacingLeft] = useState(false);
  const { x, y, w, h } = spec.area;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wander = () => {
      setPos((cur) => {
        const next = spot({ x, y, w, h }, Math.random);
        setFacingLeft(next.x < cur.x);
        return next;
      });
      timer = setTimeout(wander, 4000 + Math.random() * 7000);
    };
    timer = setTimeout(wander, 500 + Math.random() * 3000);
    return () => clearTimeout(timer);
  }, [x, y, w, h]);
  return (
    <div
      aria-hidden
      className="village-animal pointer-events-none absolute"
      style={{
        left: pos.x,
        top: pos.y,
        width: SIZE,
        height: SIZE,
        backgroundImage: `url(/village/animals/${spec.kind}.png)`,
        backgroundSize: `${2 * SIZE}px ${SIZE}px`,
        imageRendering: "pixelated",
        transform: facingLeft ? "scaleX(-1)" : undefined,
      }}
    />
  );
}

export default function Animals({ animals }: { animals: AnimalSpec[] }) {
  return (
    <>
      {animals.map((a) => (
        <Animal key={a.id} spec={a} />
      ))}
    </>
  );
}

// An area from tile coordinates.
export const tileArea = (col: number, row: number, w: number, h: number): Area => ({ x: col * CELL, y: row * CELL, w: w * CELL, h: h * CELL });
