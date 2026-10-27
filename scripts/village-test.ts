// Tests for the village's pure logic: path-finding, every scene's layout, and
// the agent-state → villager mood mapping. Run with: npm run test:village
import { VILLAGE, sceneManifest } from "../src/components/village/manifest";
import { CELL, stampRect, unionRect, validateScene, validateStamps } from "../src/components/village/scene";
import { ALL_SCENES, INTERIORS } from "../src/components/village/scenes";
import { ROOM_ACTIONS } from "../src/components/village/rooms/actions";
import { nearestWaypoint, shortestPath, type Edge, type Waypoint } from "../src/components/village/path";
import { MOOD_PLACE, bubbleLine, nextHangout, standOffsets, villagerMood } from "../src/components/village/villagerState";
import fs from "node:fs";
import { CHARACTER_GROUPS, CHARACTER_KEYS, TRADE_LOOKS } from "../src/lib/agent/villagerLooks";
import { dayPhase, isNight, nextWake, parseHM } from "../src/lib/agent/daynight";
import path from "node:path";

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
  ALL_SCENES.flatMap((l) => l.places.filter((p) => p.action && !ROOM_ACTIONS[l.id.replace(/-\d+$/, "")]?.includes(p.action)).map((p) => `${l.id}/${p.id}:${p.action}`)),
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

// --- day and night (#100) -----------------------------------------------------------
const at = (h: number, m = 0) => new Date(2026, 9, 24, h, m);
check("times are read", [parseHM("07:30"), parseHM("7:05"), parseHM("24:00"), parseHM("noon")], [450, 425, null, null]);
check("night crosses midnight (22:00–07:00)", [21, 22, 23, 0, 3, 6, 7, 12].map((h) => isNight(at(h, 30 * Number(h === 6)), "22:00", "07:00")), [false, true, true, true, true, true, false, false]);
check("a night that doesn't cross midnight (01:00–05:00)", [0, 1, 4, 5].map((h) => isNight(at(h), "01:00", "05:00")), [false, true, true, false]);
check("bedtime equal to wake-up means no night", isNight(at(3), "07:00", "07:00"), false);
check("dawn, day, dusk and night", [at(7, 30), at(12), at(21), at(23)].map((d) => dayPhase(d, "22:00", "07:00")), ["dawn", "day", "dusk", "night"]);
check("the next wake-up is tomorrow after it's passed", nextWake(at(23), "07:00").getDate(), 25);
check("…and today before it", nextWake(at(3), "07:00").getDate(), 24);
check("at night a free villager sleeps", villagerMood({ paused: false, running: false, pendingApprovals: 0, night: true }), "asleep");
check("…but one you're talking to is awake", villagerMood({ paused: false, running: true, pendingApprovals: 0, night: true }), "working");
check("…and one waiting on you waits", villagerMood({ paused: false, running: false, pendingApprovals: 1, night: true }), "waiting");

// --- several villagers ------------------------------------------------------------
check("one villager stands where they are", standOffsets(["c"]), [0]);
check("two at one spot stand side by side", standOffsets(["c", "c"]), [-28, 28]);
check("villagers at different spots aren't moved", standOffsets(["c", "ws", "c"]), [-28, 0, 28]);

// --- speech bubbles -----------------------------------------------------------
check("a bubble is the first sentence", bubbleLine("Morning! The disk looks fine. More below."), "Morning!");
check("markdown is dropped", bubbleLine("**Done** — I tidied the [notes](/api/files/notes/a.md)."), "Done — I tidied the notes.");
check(
  "code, tables and lists aren't said aloud",
  bubbleLine(["```sh", "df -h", "```", "| a | b |", "- one", "All good here."].join("\n")),
  "All good here.",
);
check("a reply that's only code has no bubble", bubbleLine(["```", "SELECT 1;", "```"].join("\n")), null);
check("long sentences are cut at a word", bubbleLine("a ".repeat(60).trim() + "."), `${"a ".repeat(39).trim()}…`);

// --- JSX text the compiler mangles ---------------------------------------------
// In this build, JSX text that starts with a space right after a tag or {…}
// and contains an HTML entity (&apos; &amp; …) loses that leading space
// ("yet.Add one", "10min"). Write {" "} before it, or drop the entity.
const RISKY_JSX_TEXT = /(\}|<\/\w+>) [^<{}\n]*&(apos|amp|quot|lt|gt);/;
function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? tsxFiles(p) : e.name.endsWith(".tsx") ? [p] : [];
  });
}
check(
  "no JSX text that would lose its leading space",
  tsxFiles("src").flatMap((f) =>
    fs
      .readFileSync(f, "utf-8")
      .split("\n")
      .map((line, i) => (RISKY_JSX_TEXT.test(line) ? `${f.replace(/\\/g, "/")}:${i + 1}` : null))
      .filter(Boolean),
  ),
  [],
);

// Every villager look has its sprite sheet, in the 64×112 layout the village
// animates (#138). A PNG's size is in its header: width at byte 16, height at 20.
{
  const bad = CHARACTER_KEYS.filter((k) => {
    const f = path.join("public", "village", "characters", `${k}.png`);
    if (!fs.existsSync(f)) return true;
    const head = fs.readFileSync(f).subarray(0, 24);
    return head.readUInt32BE(16) !== 64 || head.readUInt32BE(20) !== 112;
  });
  check("every look has a 64×112 sprite sheet", bad, []);
  const grouped = CHARACTER_GROUPS.flatMap((g) => g.keys);
  check("the look picker shows every look once", [CHARACTER_KEYS.filter((k) => !grouped.includes(k)), grouped.length], [[], CHARACTER_KEYS.length]);
  check("trade looks are real looks", Object.values(TRADE_LOOKS).flat().filter((k) => !(CHARACTER_KEYS as readonly string[]).includes(k)), []);
}

if (failures > 0) {
  console.error(`\n${failures} village test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll village tests passed.");
