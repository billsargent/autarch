"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { SPRITE, type Place, type SceneManifest } from "./manifest";
import { nearestWaypoint, shortestPath } from "./path";
import type { DayPhase } from "@/lib/agent/daynight";

// A pixel-art scene (the village or a room): the art scaled to fit, pan and
// zoom, clickable places, villagers walking the waypoint graph, night, and an
// ?edit=1 overlay for mapping art. Pages around it add their own top bar,
// drawers and dialogs as children.

const WALK_SPEED = 240; // scene px per second
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const SPRITE_PX = SPRITE.frame * SPRITE.scale;

type Facing = (typeof SPRITE.directions)[number];

export interface VillagerSpec {
  id: string;
  name: string;
  color: string;
  sprite: string;
  // Waypoint the villager walks to (and stays at).
  target: string;
  badge?: string;
  title?: string;
  said?: string | null;
  // Speech bubbles are hidden while asleep.
  asleep?: boolean;
  // Workers wear a hi-vis vest (#99).
  vest?: boolean;
  // Lying down: asleep in bed (#111).
  lying?: boolean;
  // Small hint under the name tag, e.g. "T talk".
  hint?: ReactNode;
  // Sideways nudge (scene px) so villagers at the same spot don't overlap.
  offset?: number;
  onClick?: () => void;
}

// The owner, walking the scene (#109): arrow keys or WASD, a click on the
// ground to walk there, and Space (or E) to use whatever is close by.
export interface PlayerSpec {
  name: string;
  color: string;
  sprite: string;
  // Waypoint to start at (default: the scene's spawn).
  start?: string;
}

interface SceneViewProps {
  scene: SceneManifest;
  villagers: VillagerSpec[];
  player?: PlayerSpec;
  // The light: the time of day (#100), or "frozen" while everyone is paused.
  light?: SceneLight;
  // "signs": always-visible signs above places (the village);
  // "hover": a label appears on hover or keyboard focus (rooms).
  labels: "signs" | "hover";
  onPlace: (place: Place) => void;
  // Shown bottom-centre on wider screens.
  hints?: ReactNode;
  // Overlays inside the stage: drawers, prompts, status notes.
  children?: ReactNode;
  // Drawn on the scene itself, under the villagers (buildings on plots, #105).
  overlays?: ReactNode;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

function PlaceholderMap({ scene }: { scene: SceneManifest }) {
  const byId = new Map(scene.waypoints.map((w) => [w.id, w]));
  return (
    <div className="village-grass absolute inset-0">
      <svg className="absolute inset-0" width={scene.width} height={scene.height} aria-hidden>
        {scene.edges.map(([a, b]) => {
          const p = byId.get(a);
          const q = byId.get(b);
          if (!p || !q) return null;
          return (
            <g key={`${a}-${b}`}>
              <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#a77c4f" strokeWidth={70} strokeLinecap="round" />
              <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#c9a06a" strokeWidth={54} strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
      {/* Fallback only — shown if the scene art fails to load. */}
      {scene.places.map((p) => (
        <div
          key={p.id}
          className="absolute rounded border-4 border-[#3b2716] bg-[#c99a62]/80"
          style={{ left: p.rect.x, top: p.rect.y, width: p.rect.w, height: p.rect.h }}
        />
      ))}
    </div>
  );
}

function PlaceHotspots({
  scene,
  labels,
  onPlace,
}: {
  scene: SceneManifest;
  labels: "signs" | "hover";
  onPlace: (p: Place) => void;
}) {
  // Only places that do something are clickable.
  const active = scene.places.filter((p) => p.href || p.interior || p.action);
  return (
    <>
      {active.map((p) => (
        <div key={p.id} className="group absolute" style={{ left: p.rect.x, top: p.rect.y, width: p.rect.w, height: p.rect.h }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlace(p);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`${p.label} — ${p.role}`}
            title={p.role}
            className="absolute inset-0 rounded-md outline-none hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-4 focus-visible:outline-[#e3b04b]"
          />
          <span
            className={`village-sign pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 -translate-y-full whitespace-nowrap px-3 py-1 text-[22px] ${
              labels === "signs" ? "" : "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            {p.label}
          </span>
        </div>
      ))}
    </>
  );
}

function EditOverlay({ scene, cursor }: { scene: SceneManifest; cursor: { x: number; y: number } | null }) {
  const byId = new Map(scene.waypoints.map((w) => [w.id, w]));
  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="absolute inset-0" width={scene.width} height={scene.height}>
        {scene.edges.map(([a, b]) => {
          const p = byId.get(a);
          const q = byId.get(b);
          return p && q ? <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#ff00ff" strokeWidth={3} strokeDasharray="8 6" /> : null;
        })}
        {scene.places.map((p) => (
          <rect key={p.id} x={p.rect.x} y={p.rect.y} width={p.rect.w} height={p.rect.h} fill="rgba(255,0,255,0.08)" stroke="#ff00ff" strokeWidth={3} />
        ))}
        {scene.waypoints.map((w) => (
          <circle key={w.id} cx={w.x} cy={w.y} r={9} fill="#ff00ff" />
        ))}
      </svg>
      {scene.places.map((p) => (
        <span key={p.id} className="absolute bg-black/70 px-1 font-mono text-[16px] text-white" style={{ left: p.rect.x + 4, top: p.rect.y + 4 }}>
          {p.id} {p.rect.x},{p.rect.y} {p.rect.w}×{p.rect.h}
        </span>
      ))}
      {scene.waypoints.map((w) => (
        <span key={w.id} className="absolute bg-black/70 px-1 font-mono text-[16px] text-white" style={{ left: w.x + 12, top: w.y - 10 }}>
          {w.id} {w.x},{w.y}
        </span>
      ))}
      {cursor && (
        <span className="absolute bg-[#ff00ff] px-1 font-mono text-[16px] text-white" style={{ left: cursor.x + 14, top: cursor.y + 14 }}>
          {Math.round(cursor.x)},{Math.round(cursor.y)}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The owner's character: drawn like a villager, steered by SceneView.
// ---------------------------------------------------------------------------

const PLAYER_SPEED = 300; // scene px per second
const USE_RANGE = 96; // how close (scene px) something must be to use it

interface PlayerState {
  x: number;
  y: number;
  facing: Facing;
  walking: boolean;
  frame: number;
}

function Avatar({ p, me, hint }: { p: PlayerSpec; me: PlayerState; hint: string | null }) {
  return (
    <div className="pointer-events-none absolute" style={{ left: me.x, top: me.y, transform: "translate(-50%, -100%)", zIndex: 5 }} data-player>
      {hint && (
        <div className="village-bubble absolute bottom-full left-1/2 mb-2 w-max max-w-[360px] -translate-x-1/2 px-2 py-1 text-[18px]">
          <kbd className="font-bold">Space</kbd> {hint}
        </div>
      )}
      <span
        className="relative block"
        style={{
          width: SPRITE_PX,
          height: SPRITE_PX,
          backgroundImage: `url(${p.sprite})`,
          backgroundSize: `${SPRITE.sheetWidth * SPRITE.scale}px ${SPRITE.sheetHeight * SPRITE.scale}px`,
          backgroundPosition: `-${SPRITE.directions.indexOf(me.facing) * SPRITE_PX}px -${(me.walking ? me.frame % SPRITE.walkFrames : 0) * SPRITE_PX}px`,
          imageRendering: "pixelated",
        }}
      />
      <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2">
        <span className="village-pixel whitespace-nowrap rounded border-2 border-[#3b2716] px-2 text-[18px] text-white" style={{ background: p.color }}>
          {p.name}
        </span>
      </div>
    </div>
  );
}

// What's within reach of a point: the nearest usable place or villager.
type Reachable = { kind: "place"; place: Place; label: string } | { kind: "villager"; v: VillagerSpec; label: string };
function nearestUsable(scene: SceneManifest, villagers: VillagerSpec[], x: number, y: number): Reachable | null {
  let best: { d: number; r: Reachable } | null = null;
  for (const place of scene.places) {
    if (!(place.href || place.interior || place.action)) continue;
    const cx = Math.max(place.rect.x, Math.min(x, place.rect.x + place.rect.w));
    const cy = Math.max(place.rect.y, Math.min(y, place.rect.y + place.rect.h));
    const d = Math.hypot(x - cx, y - cy);
    if (d <= USE_RANGE && (!best || d < best.d)) best = { d, r: { kind: "place", place, label: place.label } };
  }
  for (const v of villagers) {
    if (!v.onClick) continue;
    const w = scene.waypoints.find((p) => p.id === v.target);
    if (!w) continue;
    const d = Math.hypot(x - (w.x + (v.offset ?? 0)), y - w.y);
    if (d <= USE_RANGE && (!best || d < best.d)) best = { d, r: { kind: "villager", v, label: `Talk to ${v.name}` } };
  }
  return best?.r ?? null;
}

// ---------------------------------------------------------------------------
// Villager: walks itself along the scene's road graph to its target waypoint.
// ---------------------------------------------------------------------------

function WalkingVillager({ scene, v }: { scene: SceneManifest; v: VillagerSpec }) {
  const spawn = scene.waypoints.find((w) => w.id === scene.spawn) ?? scene.waypoints[0];
  const [pos, setPos] = useState({ x: spawn.x, y: spawn.y });
  const [facing, setFacing] = useState<Facing>("down");
  const [walking, setWalking] = useState(false);
  const [frame, setFrame] = useState(0);
  const [spriteReady, setSpriteReady] = useState(false);
  const posRef = useRef(pos);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setSpriteReady(true);
    img.src = v.sprite;
  }, [v.sprite]);

  useEffect(() => {
    const start = nearestWaypoint(scene.waypoints, posRef.current.x, posRef.current.y);
    const route = shortestPath(scene.waypoints, scene.edges, start.id, v.target) ?? [v.target];
    const byId = new Map(scene.waypoints.map((w) => [w.id, w]));
    const queue = route.map((id) => byId.get(id)!).filter(Boolean);
    let raf = 0;
    let last = performance.now();
    let frameClock = 0;

    const step = (now: number) => {
      // rAF timestamps can be slightly earlier than performance.now() above.
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      const next = queue[0];
      if (!next) {
        setWalking(false);
        setFacing("down");
        return;
      }
      const cur = posRef.current;
      const dx = next.x - cur.x;
      const dy = next.y - cur.y;
      const dist = Math.hypot(dx, dy);
      const stride = WALK_SPEED * dt;
      const arrived = dist <= Math.max(stride, 0.5);
      const moved = arrived ? { x: next.x, y: next.y } : { x: cur.x + (dx / dist) * stride, y: cur.y + (dy / dist) * stride };
      if (arrived) queue.shift();
      if (dist > 0.5) setFacing(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
      posRef.current = moved;
      setPos(moved);
      setWalking(true);
      frameClock += dt;
      if (frameClock > 0.125) {
        frameClock = 0;
        setFrame((f) => (f + 1) % SPRITE.walkFrames);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scene, v.target]);

  return (
    <div className="absolute transition-[margin] duration-300" style={{ left: pos.x, top: pos.y, marginLeft: v.offset ?? 0, transform: "translate(-50%, -100%)" }}>
      {v.said && !walking && !v.asleep && (
        <div className="village-bubble absolute bottom-full left-1/2 mb-14 w-max max-w-[420px] -translate-x-1/2 px-3 py-2 text-[20px] leading-snug">
          {v.said}
        </div>
      )}
      {v.badge && (
        <div className="village-badge absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-[34px]" title={v.title}>
          {v.badge}
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          v.onClick?.();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={v.title}
        aria-label={v.title ?? v.name}
        className={`relative block ${walking && !spriteReady ? "village-walking" : ""}`}
        style={{ width: spriteReady ? SPRITE_PX : 64, height: spriteReady ? SPRITE_PX : 64, transform: v.lying && !walking ? "rotate(-90deg)" : undefined }}
      >
        {spriteReady ? (
          <span
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${v.sprite})`,
              backgroundSize: `${SPRITE.sheetWidth * SPRITE.scale}px ${SPRITE.sheetHeight * SPRITE.scale}px`,
              backgroundPosition: `-${SPRITE.directions.indexOf(facing) * SPRITE_PX}px -${(walking ? frame % SPRITE.walkFrames : 0) * SPRITE_PX}px`,
              imageRendering: "pixelated",
            }}
          />
        ) : null}
        {spriteReady && v.vest && (
          <span
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: "28%",
              width: "44%",
              top: "75%",
              height: "13%",
              background: "linear-gradient(180deg, #f5d000 0 40%, #fff6c2 40% 55%, #f5d000 55%)",
              opacity: 0.85,
              borderRadius: 2,
            }}
          />
        )}
        {spriteReady ? null : (
          <span className="absolute inset-0">
            <span className="absolute left-1/2 top-[2px] h-[24px] w-[24px] -translate-x-1/2 rounded-full border-[3px] border-[#3b2716] bg-[#f1c27d]" />
            <span className="absolute left-1/2 top-[24px] h-[26px] w-[30px] -translate-x-1/2 rounded-t-md border-[3px] border-[#3b2716]" style={{ background: v.color }} />
            <span className="absolute left-[19px] top-[48px] h-[14px] w-[9px] border-[3px] border-[#3b2716] bg-[#5a3d25]" />
            <span className="absolute right-[19px] top-[48px] h-[14px] w-[9px] border-[3px] border-[#3b2716] bg-[#5a3d25]" />
          </span>
        )}
      </button>
      <div className="absolute left-1/2 top-full mt-1 flex -translate-x-1/2 flex-col items-center gap-1">
        <span className="village-pixel whitespace-nowrap rounded border-2 border-[#3b2716] px-2 text-[18px] text-white" style={{ background: v.color }}>
          {v.name}
        </span>
        {v.hint && <span className="hidden whitespace-nowrap rounded border-2 border-[#3b2716] bg-[#f4ead5] px-1.5 text-[15px] sm:inline">{v.hint}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export type SceneLight = DayPhase | "frozen";

export default function SceneView({ scene, villagers, player, light = "day", labels, onPlace, hints, children, overlays }: SceneViewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Landscape screens see the whole scene. On tall (phone) screens a wide
  // scene would be a thin strip, so it fills most of the height instead and
  // you pan sideways.
  const contain = stage.w && stage.h ? Math.min(stage.w / scene.width, stage.h / scene.height) : 0;
  const fit = stage.h > stage.w ? Math.max(contain, Math.min(1.6, (stage.h * 0.7) / scene.height)) : contain;
  const scale = fit * zoom;
  const slackX = Math.max(0, (scene.width * scale - stage.w) / 2);
  const slackY = Math.max(0, (scene.height * scale - stage.h) / 2);
  const panX = Math.max(-slackX, Math.min(slackX, pan.x));
  const panY = Math.max(-slackY, Math.min(slackY, pan.y));
  const canPan = slackX > 0 || slackY > 0;
  const originX = (stage.w - scene.width * scale) / 2 + panX;
  const originY = (stage.h - scene.height * scale) / 2 + panY;

  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);
  const zoomToFit = useCallback(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  // ?edit=1 shows hotspot outlines and coordinates for mapping new art.
  const [editMode, setEditMode] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setEditMode(new URLSearchParams(window.location.search).has("edit")), 0);
    return () => clearTimeout(t);
  }, []);

  // The drawn placeholder shows until the scene art loads.
  const [mapReady, setMapReady] = useState(false);

  // Keyboard: Z whole scene, +/- zoom. Pages add their own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.key === "z" || e.key === "Z") zoomToFit();
      else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-") zoomBy(0.8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, zoomToFit]);

  // --- the owner's character (#109) ---
  const startAt = scene.waypoints.find((w) => w.id === (player?.start ?? scene.spawn)) ?? scene.waypoints[0];
  const [me, setMe] = useState<PlayerState>({ x: startAt.x, y: startAt.y, facing: "down", walking: false, frame: 0 });
  const meRef = useRef(me);
  const held = useRef(new Set<string>());
  const route = useRef<Array<{ x: number; y: number }>>([]);
  // The latest values the loop and the key handler need.
  // `follow`: the scene is bigger than the screen (zoomed in, or a phone), so
  // the view keeps you in sight (#82).
  const live = useRef({ scale: 0, follow: false, villagers, onPlace });
  useEffect(() => {
    live.current = { scale: fit * zoom, follow: canPan, villagers, onPlace };
  });

  const inside = (r: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const standable = useCallback(
    (x: number, y: number) =>
      (!scene.walkable.length || scene.walkable.some((r) => inside(r, x, y))) && !scene.blocked.some((r) => inside({ x: r.x + 4, y: r.y - 6, w: r.w - 8, h: r.h + 6 }, x, y)),
    [scene.walkable, scene.blocked],
  );

  useEffect(() => {
    if (!player) return;
    const DIRS: Record<string, [number, number]> = {
      ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
      ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
      ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
      ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    };
    const busyTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      return Boolean(t.closest("input, textarea, select, button, a, [role=dialog]") || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (busyTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (DIRS[e.key]) {
        e.preventDefault();
        held.current.add(e.key);
        route.current = [];
      } else if (e.key === " " || e.key === "e" || e.key === "E" || e.key === "Enter") {
        const near = nearestUsable(scene, live.current.villagers, meRef.current.x, meRef.current.y);
        if (!near) return;
        e.preventDefault();
        if (near.kind === "place") live.current.onPlace(near.place);
        else near.v.onClick?.();
      }
    };
    const up = (e: KeyboardEvent) => held.current.delete(e.key);
    const blur = () => held.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);

    let raf = 0;
    let last = performance.now();
    let frameClock = 0;
    const tick = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      const cur = meRef.current;
      let dx = 0;
      let dy = 0;
      for (const k of held.current) {
        dx += DIRS[k]?.[0] ?? 0;
        dy += DIRS[k]?.[1] ?? 0;
      }
      let next = { x: cur.x, y: cur.y };
      const stride = PLAYER_SPEED * dt;
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        const tx = cur.x + (dx / len) * stride;
        const ty = cur.y + (dy / len) * stride;
        // Slide along edges: try both axes, then each alone.
        if (standable(tx, ty)) next = { x: tx, y: ty };
        else if (standable(tx, cur.y)) next = { x: tx, y: cur.y };
        else if (standable(cur.x, ty)) next = { x: cur.x, y: ty };
      } else if (route.current.length) {
        const goal = route.current[0];
        const gx = goal.x - cur.x;
        const gy = goal.y - cur.y;
        const dist = Math.hypot(gx, gy);
        if (dist <= Math.max(stride, 0.5)) {
          next = goal;
          route.current.shift();
        } else next = { x: cur.x + (gx / dist) * stride, y: cur.y + (gy / dist) * stride };
        dx = gx;
        dy = gy;
      }
      const moved = next.x !== cur.x || next.y !== cur.y;
      if (moved || cur.walking) {
        frameClock += dt;
        const facing: Facing = !moved ? cur.facing : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        const state = {
          x: next.x,
          y: next.y,
          facing,
          walking: moved,
          frame: frameClock > 0.125 ? (cur.frame + 1) % SPRITE.walkFrames : cur.frame,
        };
        if (frameClock > 0.125) frameClock = 0;
        meRef.current = state;
        setMe(state);
        // Zoomed in, the view follows you.
        if (moved && live.current.follow) {
          const k = live.current.scale;
          setPan({ x: (scene.width / 2 - next.x) * k, y: (scene.height / 2 - next.y) * k });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [player, scene, standable]);

  // A click on open ground walks you there along the roads.
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  function walkTo(clientX: number, clientY: number) {
    const el = stageRef.current;
    if (!player || !el || !scale) return;
    const r = el.getBoundingClientRect();
    const x = (clientX - r.left - originX) / scale;
    const y = (clientY - r.top - originY) / scale;
    const from = nearestWaypoint(scene.waypoints, meRef.current.x, meRef.current.y);
    const to = nearestWaypoint(scene.waypoints, x, y);
    const path = shortestPath(scene.waypoints, scene.edges, from.id, to.id) ?? [to.id];
    const byId = new Map(scene.waypoints.map((w) => [w.id, w]));
    route.current = [...path.map((id) => byId.get(id)!).filter(Boolean).map((w) => ({ x: w.x, y: w.y })), ...(standable(x, y) ? [{ x, y }] : [])];
  }
  const reach = player ? nearestUsable(scene, villagers, me.x, me.y) : null;

  // Pointer drag to pan, two fingers to pinch-zoom.
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-scene-overlay]")) return;
    pressAt.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (editMode && stageRef.current && scale) {
      const r = stageRef.current.getBoundingClientRect();
      setCursor({ x: (e.clientX - r.left - originX) / scale, y: (e.clientY - r.top - originY) / scale });
    }
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.current.dist;
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStart.current.zoom * ratio)));
    } else if (pointers.current.size === 1 && canPan) {
      const clamp = (v: number, s: number) => Math.max(-s, Math.min(s, v));
      setPan((p) => ({ x: clamp(p.x + e.clientX - prev.x, slackX), y: clamp(p.y + e.clientY - prev.y, slackY) }));
    }
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    // A tap (not a drag) on the ground, not on a place or a villager.
    const press = pressAt.current;
    pressAt.current = null;
    if (press && pointers.current.size === 1 && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6 && !(e.target as HTMLElement).closest("button, a")) {
      walkTo(e.clientX, e.clientY);
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  }

  return (
    <div
      ref={stageRef}
      className="relative flex-1 touch-none overflow-hidden select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      style={{ cursor: canPan ? "grab" : "default" }}
    >
      {scale > 0 && (
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: scene.width, height: scene.height, transform: `translate(${originX}px, ${originY}px) scale(${scale})` }}
        >
          <PlaceholderMap scene={scene} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={scene.image}
            alt=""
            draggable={false}
            onLoad={() => setMapReady(true)}
            onError={() => setMapReady(false)}
            className="absolute inset-0 h-full w-full"
            style={{ imageRendering: "pixelated", display: mapReady ? "block" : "none" }}
          />
          {light !== "day" && <div className={`village-light-${light} pointer-events-none absolute inset-0`} data-light={light} />}
          {(light === "dusk" || light === "night") &&
            scene.lamps.map((l, i) => (
              <div key={i} className="village-lamp pointer-events-none absolute" style={{ left: l.x - 120, top: l.y - 120, width: 240, height: 240 }} />
            ))}
          <PlaceHotspots scene={scene} labels={labels} onPlace={(p) => !editMode && onPlace(p)} />
          {overlays}
          {villagers.map((v) => (
            <WalkingVillager key={v.id} scene={scene} v={v} />
          ))}
          {player && <Avatar p={player} me={me} hint={reach?.label ?? null} />}
          {editMode && <EditOverlay scene={scene} cursor={cursor} />}
        </div>
      )}

      {hints && (
        <div className="absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 gap-3 rounded border-2 border-[#3b2716] bg-[#f4ead5]/90 px-2 py-1 text-[11px] sm:flex">
          {hints}
          <span><kbd className="font-bold">Z</kbd> whole view</span>
          <span><kbd className="font-bold">+ −</kbd> zoom</span>
        </div>
      )}

      <p className="absolute bottom-16 left-3 z-10 rounded bg-[#f4ead5]/80 px-1.5 py-0.5 text-[10px] sm:bottom-3 sm:left-auto sm:right-16">
        Art:{" "}
        <a href="https://limezu.itch.io/serenevillage" target="_blank" rel="noopener noreferrer" className="underline">
          LimeZu
        </a>{" "}
        (CC BY 4.0) ·{" "}
        <a href="https://pixel-boy.itch.io/ninja-adventure-asset-pack" target="_blank" rel="noopener noreferrer" className="underline">
          Pixel-boy &amp; AAA
        </a>{" "}
        (CC0)
      </p>

      <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-2">
        <button onClick={() => zoomBy(1.25)} className="village-btn h-9 w-9 text-lg" aria-label="Zoom in">+</button>
        <button onClick={() => zoomBy(0.8)} className="village-btn h-9 w-9 text-lg" aria-label="Zoom out">−</button>
        <button onClick={zoomToFit} className="village-btn h-9 w-9 text-sm" aria-label="Whole view">⤢</button>
      </div>

      {editMode && (
        <p className="absolute right-3 top-3 z-10 rounded bg-[#ff00ff] px-2 py-1 font-mono text-xs text-white">
          edit mode — {scene.id} art: {mapReady ? "loaded" : "placeholder"}
        </p>
      )}

      {/* Drawers, dialogs and notes; pointer events here don't pan the scene. */}
      <div data-scene-overlay className="contents">
        {children}
      </div>
    </div>
  );
}
