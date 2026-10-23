// Tests for the village's pure logic: path-finding, every scene's layout, and
// the agent-state → villager mood mapping. Run with: npm run test:village
import { VILLAGE, sceneManifest } from "../src/components/village/manifest";
import { CELL, stampRect, unionRect, validateScene, validateStamps } from "../src/components/village/scene";
import { ALL_SCENES, INTERIORS } from "../src/components/village/scenes";
import { ROOM_ACTIONS } from "../src/components/village/rooms/actions";
import { nearestWaypoint, shortestPath, type Edge, type Waypoint } from "../src/components/village/path";
import { MOOD_PLACE, nextHangout, villagerMood } from "../src/components/village/villagerState";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) console.log(`✓ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
}

// --- path-finding on a small known graph ----------------------------------
// a ── b ── c        a→c along the top is 200; via d is longer.
// └──── d ────┘
const nodes: Waypoint[] = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 100, y: 0 },
  { id: "c", x: 200, y: 0 },
  { id: "d", x: 100, y: 300 },
  { id: "island", x: 999, y: 999 },
];
const edges: Edge[] = [
  ["a", "b"],
  ["b", "c"],
  ["a", "d"],
  ["d", "c"],
];
check("shortest route is taken", shortestPath(nodes, edges, "a", "c"), ["a", "b", "c"]);
check("path to itself is one node", shortestPath(nodes, edges, "b", "b"), ["b"]);
check("unreachable returns null", shortestPath(nodes, edges, "a", "island"), null);
check("unknown node returns null", shortestPath(nodes, edges, "a", "nope"), null);
check("nearest waypoint", nearestWaypoint(nodes, 190, 20).id, "c");

// --- every scene is consistent ---------------------------------------------
// Stamps inside their tilesets, nothing off the map, no overlaps, nothing on a
// path or a waypoint, every waypoint on walkable ground, doors and edges valid.
check("all stamps lie inside their tilesets", validateStamps(), []);
for (const layout of ALL_SCENES) {
  const scene = sceneManifest(layout);
  check(`${layout.id}: no layout problems`, validateScene(layout), []);
  check(`${layout.id}: size matches the layout`, [scene.width, scene.height], [layout.cols * CELL, layout.rows * CELL]);
  check(
    `${layout.id}: hotspots match the layout`,
    scene.places.map((p) => p.rect),
    layout.places.map((p) => {
      const r = unionRect(p.parts.map(stampRect));
      return { x: r.col * CELL, y: r.row * CELL, w: r.w * CELL, h: r.h * CELL };
    }),
  );
  const unreachable: string[] = [];
  for (const from of scene.waypoints) {
    for (const p of scene.places) {
      if (!shortestPath(scene.waypoints, scene.edges, from.id, p.door)) unreachable.push(`${from.id}→${p.id}`);
    }
    if (scene.exit && !shortestPath(scene.waypoints, scene.edges, from.id, scene.exit)) unreachable.push(`${from.id}→exit`);
  }
  check(`${layout.id}: every place (and the exit) is reachable from every waypoint`, unreachable, []);
}

// --- the village links to real rooms -----------------------------------------
check(
  "every building's room exists",
  VILLAGE.places.filter((p) => p.interior && !INTERIORS[p.interior]).map((p) => p.id),
  [],
);
check("every room has a way out", Object.values(INTERIORS).filter((l) => !l.exit).map((l) => l.id), []);
check(
  "room furniture always does something",
  Object.values(INTERIORS).flatMap((l) => l.places.filter((p) => !p.action).map((p) => `${l.id}/${p.id}`)),
  [],
);
check(
  "every furniture action has a room UI that handles it",
  ALL_SCENES.flatMap((l) => l.places.filter((p) => p.action && !ROOM_ACTIONS[l.id]?.includes(p.action)).map((p) => `${l.id}/${p.id}:${p.action}`)),
  [],
);
check(
  "every village place opens something",
  VILLAGE.places.filter((p) => !p.interior && !p.href && !p.action && p.id !== "pond").map((p) => p.id),
  [],
);
const placeIds = new Set(VILLAGE.places.map((p) => p.id));
check("every mood maps to a real building", Object.values(MOOD_PLACE).every((id) => placeIds.has(id)), true);

// --- agent state → mood ---------------------------------------------------
check("paused wins over everything", villagerMood({ paused: true, running: true, pendingApprovals: 2 }), "asleep");
check("pending approval outranks work", villagerMood({ paused: false, running: true, pendingApprovals: 1 }), "waiting");
check("running means working", villagerMood({ paused: false, running: true, pendingApprovals: 0 }), "working");
check("next hangout never repeats the current one", [0, 0.3, 0.6, 0.99].map((r) => nextHangout("b", ["a", "b", "c"], r)), ["a", "a", "c", "c"]);
check("next hangout with no hangouts stays put", nextHangout("a", [], 0.5), "a");
check(
  "village hangouts are real waypoints",
  VILLAGE.hangouts.filter((h) => !VILLAGE.waypoints.some((w) => w.id === h)),
  [],
);
check("nothing going on means idle", villagerMood({ paused: false, running: false, pendingApprovals: 0 }), "idle");

if (failures > 0) {
  console.error(`\n${failures} village test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll village tests passed.");
