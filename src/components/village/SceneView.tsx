"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { SPRITE, type Place, type SceneManifest } from "./manifest";
import { nearestWaypoint, shortestPath } from "./path";

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
  // Small hint under the name tag, e.g. "T talk".
  hint?: ReactNode;
  onClick?: () => void;
}

interface SceneViewProps {
  scene: SceneManifest;
  villagers: VillagerSpec[];
  night?: boolean;
  // "signs": always-visible signs above places (the village);
  // "hover": a label appears on hover or keyboard focus (rooms).
  labels: "signs" | "hover";
  onPlace: (place: Place) => void;
  // Shown bottom-centre on wider screens.
  hints?: ReactNode;
  // Overlays inside the stage: drawers, prompts, status notes.
  children?: ReactNode;
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
    <div className="absolute" style={{ left: pos.x, top: pos.y, transform: "translate(-50%, -100%)" }}>
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
        style={{ width: spriteReady ? SPRITE_PX : 64, height: spriteReady ? SPRITE_PX : 64 }}
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
        ) : (
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

export default function SceneView({ scene, villagers, night = false, labels, onPlace, hints, children }: SceneViewProps) {
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

  // Pointer drag to pan, two fingers to pinch-zoom.
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-scene-overlay]")) return;
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
          {night && (
            <>
              <div className="village-night pointer-events-none absolute inset-0" />
              {scene.lamps.map((l, i) => (
                <div key={i} className="village-lamp pointer-events-none absolute" style={{ left: l.x - 120, top: l.y - 120, width: 240, height: 240 }} />
              ))}
            </>
          )}
          <PlaceHotspots scene={scene} labels={labels} onPlace={(p) => !editMode && onPlace(p)} />
          {villagers.map((v) => (
            <WalkingVillager key={v.id} scene={scene} v={v} />
          ))}
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
