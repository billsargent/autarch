// Scene manifests: what the view needs to know about a piece of art, derived
// from the scene files in scenes/ (the same files the map build script draws
// from), so hotspots always sit on the art. Open any scene with ?edit=1 to see
// the outlines. Coordinates are in scene pixels.
import { CELL, STAMPS, stampRect, unionRect, type SceneLayout } from "./scene";
import { INTERIORS, VILLAGE_SCENE } from "./scenes";
import type { Edge, Waypoint } from "./path";

export interface Place {
  id: string;
  label: string;
  // What the place stands for in the app; shown as a tooltip.
  role: string;
  rect: { x: number; y: number; w: number; h: number };
  // Waypoint a villager walks to when visiting.
  door: string;
  // Village buildings: the room they open, or a Command Center page.
  interior?: string;
  href?: string;
  // Room furniture: what clicking it does.
  action?: string;
}

export interface SceneManifest {
  id: string;
  title: string;
  width: number;
  height: number;
  image: string;
  places: Place[];
  waypoints: Waypoint[];
  edges: Edge[];
  // Lamp heads, for the night glow.
  lamps: Array<{ x: number; y: number }>;
  spawn: string;
  exit?: string;
  hangouts: string[];
}

export function sceneManifest(layout: SceneLayout): SceneManifest {
  return {
    id: layout.id,
    title: layout.title,
    width: layout.cols * CELL,
    height: layout.rows * CELL,
    image: `/village/scenes/${layout.id}.png`,
    places: layout.places.map((p) => {
      const r = unionRect(p.parts.map(stampRect));
      return {
        id: p.id,
        label: p.label,
        role: p.role,
        door: p.door,
        interior: p.interior,
        href: p.href,
        action: p.action,
        rect: { x: r.col * CELL, y: r.row * CELL, w: r.w * CELL, h: r.h * CELL },
      };
    }),
    waypoints: layout.waypoints.map((w) => ({ id: w.id, x: w.x * CELL, y: w.y * CELL })),
    edges: layout.edges,
    lamps: layout.lamps.map((l) => ({ x: (l.col + STAMPS[l.stamp].w / 2) * CELL, y: l.row * CELL + CELL / 2 })),
    spawn: layout.spawn,
    exit: layout.exit,
    hangouts: layout.hangouts ?? [],
  };
}

export const VILLAGE: SceneManifest = sceneManifest(VILLAGE_SCENE);

export function interiorManifest(id: string): SceneManifest | null {
  const layout = INTERIORS[id];
  return layout ? sceneManifest(layout) : null;
}

// Villager sprite sheets (Ninja Adventure layout): 16 px frames, one column
// per facing direction, walk-cycle frames down the rows.
export const SPRITE = {
  frame: 16,
  scale: 3,
  sheetWidth: 64,
  sheetHeight: 112,
  directions: ["down", "up", "left", "right"] as const,
  walkFrames: 4,
};

export const CHARACTERS = {
  woman: "/village/characters/woman.png",
  villager: "/village/characters/villager.png",
  villager2: "/village/characters/villager2.png",
  villager3: "/village/characters/villager3.png",
  villager4: "/village/characters/villager4.png",
  oldwoman: "/village/characters/oldwoman.png",
  inspector: "/village/characters/inspector.png",
  // Reserved for the Mayor (#58).
  master: "/village/characters/master.png",
  // Reserved for a possible night watch (docs/town-charter.md).
  knight: "/village/characters/knight.png",
} as const;

export const AGENT_CHARACTER: keyof typeof CHARACTERS = "woman";

// Each agent gets its own color (name tag, chat drawer accents).
export const AGENT_COLORS = ["#d9643a", "#4f86c6", "#5f8a3c", "#9b59b6", "#e3b04b"];
