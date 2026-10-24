// The shell every building interior shares: a back wall (cap, plaster,
// brick), thick rims down the sides and along the bottom, and a doorway in
// the middle of the bottom wall. A room adds its own floor, windows,
// furniture and waypoints.
import type { Placement, Rect, SceneLayout, StampId } from "../scene";

export const ROOM_W = 16;
export const ROOM_H = 11;
const W = ROOM_W;
const H = ROOM_H;

export const ROOM_FLOOR: Rect = { col: 1, row: 3, w: W - 2, h: H - 4 };
export const DOORWAY: Rect = { col: 7, row: H - 1, w: 2, h: 1 };

const rim: Placement[] = [
  { stamp: "rimCornerBL", col: 0, row: H - 1 },
  { stamp: "rimCornerBR", col: W - 1, row: H - 1 },
  // Rounded ends at the doorway.
  { stamp: "rimBottomEndRight", col: DOORWAY.col - 1, row: H - 1 },
  { stamp: "rimBottomEndLeft", col: DOORWAY.col + DOORWAY.w, row: H - 1 },
];

const walls: NonNullable<SceneLayout["areas"]> = [
  // Back wall: cap, plaster, brick.
  { rect: { col: 1, row: 0, w: W - 2, h: 1 }, stamp: "wallCap" },
  { rect: { col: 1, row: 1, w: W - 2, h: 1 }, stamp: "wallPlaster" },
  { rect: { col: 1, row: 2, w: W - 2, h: 1 }, stamp: "wallBrick" },
  // Side and bottom rims.
  { rect: { col: 0, row: 0, w: 1, h: H - 1 }, stamp: "rimLeft" },
  { rect: { col: W - 1, row: 0, w: 1, h: H - 1 }, stamp: "rimRight" },
  { rect: { col: 1, row: H - 1, w: DOORWAY.col - 2, h: 1 }, stamp: "rimBottom" },
  { rect: { col: DOORWAY.col + DOORWAY.w + 1, row: H - 1, w: W - 2 - DOORWAY.col - DOORWAY.w, h: 1 }, stamp: "rimBottom" },
];

type RoomParts = Pick<SceneLayout, "id" | "title" | "places" | "decor" | "waypoints" | "edges"> & {
  floor?: StampId;
  // Windows, rugs and the like, drawn on the floor and walls.
  ground?: Placement[];
};

// A complete interior scene: the shell plus the room's own parts. Every room
// has "door" (the way out) and "center" waypoints; the room's waypoints are
// added to them.
export function interior(room: RoomParts): SceneLayout {
  return {
    id: room.id,
    title: room.title,
    cols: W,
    rows: H,
    fill: [{ stamp: room.floor ?? "plankFloor", weight: 1 }],
    areas: walls,
    ground: [...rim, ...(room.ground ?? []), { stamp: "doormat", col: DOORWAY.col, row: H - 2 }],
    places: room.places,
    decor: room.decor,
    lamps: [],
    walkable: [ROOM_FLOOR, DOORWAY],
    waypoints: [{ id: "door", x: 8, y: 10.4 }, { id: "center", x: 8, y: 8.6 }, ...room.waypoints],
    edges: [["door", "center"], ...room.edges],
    spawn: "door",
    exit: "door",
  };
}
