"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "./village.css";
import { villageFonts } from "./fonts";
import { OWNER_SPRITE, VILLAGE, VILLAGE_MANIFESTS, spriteFor, type Place, type SceneManifest } from "./manifest";
import type { PlayerSpec } from "./SceneView";
import StampSprite from "./StampSprite";
import { CELL, STAMPS, stampRect, type StampId } from "./scene";
import { VILLAGE_LEVELS } from "./scenes";
import { useBuildings } from "../data/useBuildings";
import { useVillageSound } from "./useVillageSound";
import WelcomeDialog from "./WelcomeDialog";
import Animals, { type AnimalSpec } from "./Animals";
import { TRADES, type TradeKey } from "@/lib/agent/trades";
import type { VillagerLife } from "@/lib/agent/clientTypes";
import { BUBBLE_MS, MOOD_BADGE, MOOD_PLACE, bubbleLine, moodLabel, nextHangout, standOffsets, villagerMood } from "./villagerState";
import { snapshotOf, useVillageData } from "./useVillageData";
import SceneView, { type VillagerSpec } from "./SceneView";
import VillageHud from "./VillageHud";
import TalkDrawer from "./TalkDrawer";
import ApprovalPrompt from "./ApprovalPrompt";
import ParchmentDialog from "./ParchmentDialog";
import VillagerPortrait from "./VillagerPortrait";
import { ROOMS } from "./rooms";
import { useDeferredApprovals } from "./useDeferredApprovals";
import { useVillageClock } from "./useVillageClock";

// A new villager (#99) greets the village for their first hour.
const NEWCOMER_MS = 60 * 60_000;

// You walk the village too (#109): you start at your front door, or at the
// door of the building you just left (?from=<place>).
function startingDoor(): string {
  const from = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("from");
  return VILLAGE.places.find((p) => p.id === from)?.door ?? VILLAGE.places.find((p) => p.id === "home")?.door ?? VILLAGE.spawn;
}

// How far the land reaches (#105), remembered so a visit doesn't start on
// the smaller village and then jump.
const LEVEL_KEY = "village.level";
function rememberedLevel(): number {
  try {
    const n = Number(window.localStorage.getItem(LEVEL_KEY));
    return Number.isInteger(n) && n >= 0 && n < VILLAGE_MANIFESTS.length ? n : 0;
  } catch {
    return 0;
  }
}

export default function VillageView() {
  const buildings = useBuildings();
  // Read after mount: the server renders level 0, and the first client render
  // must match it.
  const [savedLevel, setSavedLevel] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setSavedLevel(rememberedLevel()), 0);
    return () => clearTimeout(t);
  }, []);
  const level = Math.min(VILLAGE_MANIFESTS.length - 1, buildings.state?.level ?? savedLevel);
  const scene = VILLAGE_MANIFESTS[level];
  const levelKnown = buildings.state != null;
  useEffect(() => {
    if (!levelKnown) return; // only remember a level the server told us
    try {
      window.localStorage.setItem(LEVEL_KEY, String(level));
    } catch {
      /* private window: fine */
    }
  }, [level, levelKnown]);
  const [player] = useState<PlayerSpec>(() => ({ name: "You", color: "#3b2716", sprite: OWNER_SPRITE, start: startingDoor() }));
  // ?open=<action> opens an outdoor dialog straight away (the notice board, the mailbox).
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open && ["goals.board", "goals.new", "mail.open", "trade.post", "signs.directions"].includes(open)) {
      const t = setTimeout(() => openAction(open), 0);
      return () => clearTimeout(t);
    }
  }, []);
  const router = useRouter();
  const { data, refresh, mayor } = useVillageData();
  const villagers = data.villagers;
  // The village clock sets the light and puts villagers to bed (#100, #150);
  // the same tick fades speech bubbles.
  const { now: clock, time, phase, night } = useVillageClock(data.bedtime, data.wakeTime, data.villageClock, data.villageDayHours);
  const sound = useVillageSound(phase, data.pending.length, data.unread);

  // Idle villagers stroll between hangouts (plaza, market, gates, home…), each
  // on their own timer: a first walk within a few seconds, then every 20–50 s.
  // Working, waiting and sleeping keep a villager at their building.
  const [strolls, setStrolls] = useState<Record<number, string | null>>({});
  const idleIds = villagers.filter((v) => villagerMood(snapshotOf(v, data.paused, night)) === "idle").map((v) => v.id);
  const idleKey = idleIds.join(",");
  // Places to stroll to: the village's own, and the tavern once it's built.
  const hangoutKey = [
    ...scene.hangouts,
    ...(buildings.state?.buildings ?? [])
      .filter((b) => b.kind === "tavern" && b.status === "built")
      .map((b) => scene.plots.find((p) => p.id === b.plotId)?.door)
      .filter((d): d is string => Boolean(d)),
  ].join(",");
  useEffect(() => {
    const hangouts = hangoutKey.split(",");
    const ids = idleKey ? idleKey.split(",").map(Number) : [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const id of ids) {
      const wander = (delay: number) => {
        timers.push(
          setTimeout(() => {
            setStrolls((cur) => ({ ...cur, [id]: nextHangout(cur[id] ?? null, hangouts, Math.random()) }));
            wander(20_000 + Math.random() * 30_000);
          }, delay),
        );
      };
      wander(3_000 + Math.random() * 6_000);
    }
    return () => timers.forEach(clearTimeout);
  }, [idleKey, hangoutKey]);

  // Who you're talking to, whose cottage to visit, and outdoor dialogs.
  const [talkingTo, setTalkingTo] = useState<number | null>(null);
  const [choosingCottage, setChoosingCottage] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [opened, setOpened] = useState(0);
  const VillageRoom = ROOMS.village;
  const [deferred, setDeferred] = useDeferredApprovals();
  const showPrompt = data.pending.length > 0 && !data.pending.every((p) => deferred.includes(p.id));
  const promptQueue = data.pending.filter((p) => !deferred.includes(p.id));
  const talking = villagers.find((v) => v.id === talkingTo) ?? null;
  const nameOf = (agentId: number | null) => villagers.find((v) => v.id === agentId)?.name ?? mayor?.name ?? "A villager";

  const togglePause = useCallback(async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: !data.paused }),
    }).catch(() => {});
    await refresh();
  }, [data.paused, refresh]);

  // Keyboard: T talks to the Mayor (or whoever you last talked to), Esc closes.
  // (Zoom keys live in SceneView.)
  const [lastTalked, setLastTalked] = useState<number | null>(null);
  const talkKeyTarget = lastTalked ?? mayor?.id ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if ((e.key === "t" || e.key === "T") && talkKeyTarget) setTalkingTo(talkKeyTarget);
      else if (e.key === "Escape") setTalkingTo(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [talkKeyTarget]);

  function talkTo(id: number) {
    setLastTalked(id);
    setTalkingTo(id);
  }

  function openAction(act: string) {
    setTalkingTo(null);
    setAction(act);
    setOpened((n) => n + 1);
  }

  function openPlace(p: Place) {
    // Everyone has a cottage: ask whose, when there's more than one villager.
    if (p.interior === "cottage" && villagers.length > 1) setChoosingCottage(true);
    else if (p.interior === "cottage" && mayor) router.push(`/village/cottage?agent=${mayor.id}`);
    else if (p.interior) router.push(`/village/${p.interior}`);
    else if (p.action) openAction(p.action);
    else if (p.href) router.push(p.href);
  }

  // Where each villager is headed, and what the village shows of them.
  const plans = villagers.map((v) => {
    const mood = villagerMood(snapshotOf(v, data.paused, night));
    const home = scene.places.find((p) => p.id === MOOD_PLACE[mood]) ?? scene.places[0];
    // With nothing else on, a villager is wherever their village life has
    // them (#132): at work, the tavern, the plaza, a friend's, or home.
    const living = mood === "idle" && v.life ? lifeSpot(v.life, scene, buildings.state) : null;
    const stroll = mood === "idle" && !v.life ? strolls[v.id] : null;
    const target = living ?? stroll ?? home.door;
    return { v, mood, target, strolling: mood === "idle" && !v.life && target !== home.door };
  });
  // A villager asking a neighbour something walks over to them (#57).
  for (const p of plans) {
    const other = p.v.talkingWith != null ? plans.find((o) => o.v.id === p.v.talkingWith) : null;
    if (other && !p.v.working && p.mood !== "asleep") {
      p.target = other.target;
      p.strolling = false;
    }
  }
  const offsets = standOffsets(plans.map((p) => p.target));
  // Villagers out and about together share one bubble ("🍺 6 at the tavern"),
  // shown over the first of them (#132).
  const lifeLine = (i: number): string | null => {
    const { v, mood, target } = plans[i];
    if (mood !== "idle" || !v.life || v.life.place === "home") return null;
    const group = plans.filter((p) => p.mood === "idle" && p.target === target && p.v.life && p.v.life.place === v.life!.place);
    if (group[0].v.id !== v.id) return null;
    const icon = PLACE_ICON[v.life.place] ?? v.life.icon;
    return group.length > 1 ? `${icon} ${group.length} ${PLACE_GROUP[v.life.place] ?? `together: ${v.life.activity}`}` : `${icon} ${v.life.activity}`;
  };
  const specs: VillagerSpec[] = plans.map(({ v, mood, target, strolling }, i) => ({
    id: `agent-${v.id}`,
    name: v.name,
    color: v.color,
    sprite: spriteFor(v.character),
    target,
    offset: offsets[i],
    badge: MOOD_BADGE[mood],
    vest: v.tier === "worker",
    title: `${moodLabel(mood, v.name, strolling)} — click to talk`,
    said:
      v.talkingWith != null && !v.working
        ? `💬 Asking ${nameOf(v.talkingWith)}…`
        : v.lastSaid && v.lastSaidAt && clock - v.lastSaidAt < BUBBLE_MS
          ? bubbleLine(v.lastSaid)
          : mood !== "asleep" && clock - Date.parse(v.createdAt) < NEWCOMER_MS
            ? `👋 Hello! I'm ${v.name}, new in town.`
            : lifeLine(i),
    asleep: mood === "asleep",
    hint:
      v.id === talkKeyTarget ? (
        <>
          <kbd className="font-bold">T</kbd> talk
        </>
      ) : undefined,
    onClick: () => talkTo(v.id),
  }));

  const summary = data.paused
    ? "❄ Everyone is paused — nothing runs until you resume."
    : night && plans.every((p) => p.mood === "asleep")
      ? `🌙 The village is asleep until ${data.wakeTime}. You can still knock and talk.`
      : plans.length === 0
      ? "The village is quiet."
      : plans.length === 1
        ? moodLabel(plans[0].mood, plans[0].v.name, plans[0].strolling)
        : plans
            .filter((p) => p.mood !== "idle" || p.strolling)
            .slice(0, 2)
            .map((p) => moodLabel(p.mood, p.v.name, p.strolling))
            .join(" · ") || lifeSummaryLine(plans.map((p) => p.v)) || `${plans.length} villagers relaxing at home`;

  return (
    <div className={`${villageFonts} village-root flex h-full w-full flex-col`}>
      <VillageHud
        villagers={villagers.length}
        working={villagers.filter((v) => v.working).length}
        waiting={data.pending.length}
        openGoals={data.openGoals}
        spentToday={data.spentToday}
        unread={data.unread}
        paused={data.paused}
        time={time}
        phase={phase}
        onShowApprovals={() => setDeferred([])}
        onTogglePause={togglePause}
        onShowMail={() => openAction("mail.open")}
        meetingOn={villagers.some((v) => v.inMeeting)}
        soundOn={sound.soundOn}
        onToggleSound={sound.toggleSound}
        onMeeting={() => router.push("/village/townhall?open=meeting.open")}
      />

      <SceneView
        key={scene.id}
        scene={scene}
        player={player}
        overlays={
          <>
            <PlotBuildings scene={scene} state={buildings.state} onOpen={(id) => openAction(`building.${id}`)} />
            <Animals animals={villageAnimals(scene, buildings.state)} />
            <PlotSigns scene={scene} state={buildings.state} onOpen={(id) => openAction(`plot.${id}`)} />
            {(phase === "dusk" || phase === "night") && !data.paused && <LitWindows level={level} scene={scene} plots={buildings.state} />}
          </>
        }
        light={data.paused ? "frozen" : phase}
        labels="signs"
        onPlace={openPlace}
        hints={
          <>
            <span>
              <kbd className="font-bold">T</kbd> talk
            </span>
            <span>drag to pan</span>
          </>
        }
        villagers={specs}
      >
        {!talking && data.loaded && talkKeyTarget && (
          <button onClick={() => talkTo(talkKeyTarget)} className="village-btn absolute bottom-4 left-1/2 z-10 -translate-x-1/2 px-3 py-1.5 text-xs sm:hidden">
            <kbd className="mr-2 rounded border border-[#3b2716] bg-[#f4ead5] px-1 text-[#3b2716]">T</kbd>
            Talk to {nameOf(talkKeyTarget)}
          </button>
        )}

        <p className="pointer-events-none absolute left-3 top-3 z-10 max-w-[60%] rounded border-2 border-[#3b2716] bg-[#f4ead5]/90 px-2 py-1 text-xs">
          {summary}
        </p>

        {talking && <TalkDrawer key={talking.id} villager={talking} onClose={() => setTalkingTo(null)} />}

        {choosingCottage && (
          <ParchmentDialog kicker="The cottages" title="Whose cottage?" onClose={() => setChoosingCottage(false)}>
            <ul className="space-y-2">
              {villagers.map((v) => (
                <li key={v.id}>
                  <button
                    onClick={() => router.push(`/village/cottage?agent=${v.id}`)}
                    className="flex w-full items-center gap-3 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2 text-left hover:bg-white"
                  >
                    <VillagerPortrait character={v.character} color={v.color} size={32} />
                    <span>
                      <span className="village-pixel block text-sm">{v.name}&apos;s cottage</span>
                      <span className="block text-xs text-[#6b4a2e]">{v.role}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ParchmentDialog>
        )}

        {VillageRoom && action && <VillageRoom key={opened} action={action} onClose={() => setAction(null)} />}
        <WelcomeDialog />

        {showPrompt && (
          <ApprovalPrompt
            nameOf={(p) => nameOf(p.agentId)}
            pending={promptQueue}
            onDecided={() => void refresh()}
            onLater={() => setDeferred(data.pending.map((p) => p.id))}
          />
        )}
      </SceneView>
    </div>
  );
}

// What stands on the village's plots (#105): finished buildings (click one to
// open it), and scaffolding where one is going up.
// Where a villager's life has them (#132), as a waypoint of the scene.
const PLACE_ICON: Record<string, string> = { tavern: "🍺", plaza: "🚶", visit: "🫖" };
const PLACE_GROUP: Record<string, string> = { tavern: "at the tavern", plaza: "out in the plaza", visit: "having a natter", work: "at work" };

// The village at a glance, from everyone's life: "6 at the tavern · Gus working the fields".
function lifeSummaryLine(vs: Array<{ name: string; life?: VillagerLife | null }>): string {
  const groups = new Map<string, string[]>();
  for (const v of vs) {
    if (!v.life || v.life.place === "home") continue;
    const k = v.life.place === "work" ? `work:${v.life.activity}` : v.life.place;
    groups.set(k, [...(groups.get(k) ?? []), v.name]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2)
    .map(([k, names]) => {
      const place = k.startsWith("work:") ? k.slice(5) : (PLACE_GROUP[k] ?? k);
      return names.length > 1 ? `${names.length} ${place}` : `${names[0]} ${place}`;
    })
    .join(" · ");
}
function lifeSpot(life: VillagerLife, scene: SceneManifest, state: ReturnType<typeof useBuildings>["state"]): string | null {
  const has = (w: string) => scene.waypoints.some((p) => p.id === w);
  const doorOf = (kind: string | null) => {
    const b = kind ? state?.buildings.find((x) => x.kind === kind && x.status === "built") : undefined;
    return b ? scene.plots.find((p) => p.id === b.plotId)?.door : undefined;
  };
  const trade = TRADES[life.trade as TradeKey];
  switch (life.place) {
    case "work":
      return doorOf(trade?.building ?? null) ?? (trade && has(trade.spot) ? trade.spot : null);
    case "tavern":
      return doorOf("tavern") ?? (has("tr") ? "tr" : null);
    case "plaza":
      return has("c") ? "c" : null;
    case "visit":
      return has("cot") ? "cot" : null;
    default:
      return null;
  }
}

// Who lives where (#138): chickens and a cow on every farm, a cat by the
// bakery (or the cottages), a dog by your door, and a horse by the west road.
function villageAnimals(scene: SceneManifest, state: ReturnType<typeof useBuildings>["state"]): AnimalSpec[] {
  const out: AnimalSpec[] = [];
  const built = (state?.buildings ?? []).filter((b) => b.status === "built");
  const plotOf = (id: string) => scene.plots.find((p) => p.id === id);
  for (const b of built.filter((x) => x.kind === "farm")) {
    const p = plotOf(b.plotId);
    if (!p) continue;
    out.push(
      { id: `chicken-a-${b.id}`, kind: "chicken-white", area: p.rect },
      { id: `chicken-b-${b.id}`, kind: "chicken-brown", area: p.rect },
      { id: `cow-${b.id}`, kind: "cow", area: p.rect },
    );
  }
  const bakery = built.find((x) => x.kind === "bakery");
  const bakeryPlot = bakery && plotOf(bakery.plotId);
  const cottages = scene.places.find((p) => p.id === "cottages")?.rect;
  const catArea = bakeryPlot ? { ...bakeryPlot.rect, y: bakeryPlot.rect.y + bakeryPlot.rect.h - CELL, h: CELL } : cottages && { x: cottages.x, y: cottages.y + cottages.h, w: cottages.w, h: CELL };
  if (catArea) out.push({ id: "cat", kind: "cat", area: catArea });
  const home = scene.places.find((p) => p.id === "home")?.rect;
  if (home) out.push({ id: "dog", kind: "dog", area: { x: home.x - CELL * 2, y: home.y + home.h - CELL, w: CELL * 2, h: CELL } });
  const westRoad = scene.waypoints.find((w) => w.id === "wrt");
  if (westRoad) out.push({ id: "horse", kind: "horse", area: { x: CELL * 0.5, y: westRoad.y - CELL * 1.6, w: CELL * 3, h: CELL } });
  return out;
}

// A sign on every free plot (#146): click it to see what could go there.
function PlotSigns({ scene, state, onOpen }: { scene: SceneManifest; state: ReturnType<typeof useBuildings>["state"]; onOpen: (id: string) => void }) {
  if (!state) return null;
  const taken = new Set(state.buildings.filter((b) => b.kind !== "land").map((b) => b.plotId));
  return (
    <>
      {scene.plots
        .filter((p) => !taken.has(p.id))
        .map((p) => {
          const x = (p.col + 3) * CELL;
          const y = (p.row + 3) * CELL;
          return (
            <div key={p.id}>
              <StampSprite stamp="svSign" x={x} y={y} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(p.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Plot ${p.id}: free`}
                title="A free plot: what could go here?"
                className="absolute rounded outline-none hover:bg-white/20 focus-visible:outline-4 focus-visible:outline-[#e3b04b]"
                style={{ left: x, top: y, width: CELL, height: CELL }}
              />
            </div>
          );
        })}
    </>
  );
}

// The stamps and labels come with the buildings (src/lib/agent/buildings.ts).
function PlotBuildings({ scene, state, onOpen }: { scene: SceneManifest; state: ReturnType<typeof useBuildings>["state"]; onOpen: (id: number) => void }) {
  if (!state) return null;
  return (
    <>
      {state.buildings
        .filter((b) => b.status === "built" || b.status === "building")
        .map((b) => {
          const plot = scene.plots.find((p) => p.id === b.plotId);
          if (!plot || b.kind === "land") return null;
          const built = b.status === "built";
          const stamp = state.kinds[b.kind]?.stamp as StampId | undefined;
          if (!stamp || !(stamp in STAMPS)) return null;
          const label = state.kinds[b.kind].label;
          const st = STAMPS[stamp];
          const x = plot.rect.x + ((plot.w - st.w) / 2) * CELL;
          const y = plot.rect.y + (plot.h - st.h) * CELL;
          return (
            <div key={b.id}>
              {built ? (
                <StampSprite stamp={stamp} x={x} y={y} />
              ) : (
                <>
                  <StampSprite stamp={stamp} x={x} y={y} opacity={0.35} />
                  <StampSprite stamp="plankStack" x={plot.rect.x} y={plot.rect.y + (plot.h - 1) * CELL} />
                  <StampSprite stamp="lumber" x={plot.rect.x + CELL} y={plot.rect.y + (plot.h - 1) * CELL} />
                  <StampSprite stamp="handcart" x={plot.rect.x + 2 * CELL} y={plot.rect.y + (plot.h - 2) * CELL} />
                </>
              )}
              <div className="group absolute" style={{ left: plot.rect.x, top: plot.rect.y, width: plot.rect.w, height: plot.rect.h }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(b.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={`${label}${built ? "" : " (being built)"}`}
                  className="absolute inset-0 rounded-md outline-none hover:bg-white/10 focus-visible:outline-4 focus-visible:outline-[#e3b04b]"
                />
                <span className="village-sign pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 -translate-y-full whitespace-nowrap px-3 py-1 text-[22px]">
                  {built ? label : `🚧 ${label}`}
                </span>
              </div>
            </div>
          );
        })}
    </>
  );
}

// Homes with their lights on at dusk and at night (#110): yours, the
// cottages, and any houses built on the plots.
function LitWindows({ level, scene, plots }: { level: number; scene: SceneManifest; plots: ReturnType<typeof useBuildings>["state"] }) {
  const homes = VILLAGE_LEVELS[level].places.filter((p) => p.id === "home" || p.id === "cottages").flatMap((p) => p.parts.map(stampRect));
  const houses = (plots?.buildings ?? [])
    .filter((b) => b.kind === "house" && b.status === "built")
    .map((b) => scene.plots.find((p) => p.id === b.plotId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ col: p.col, row: p.row, w: p.w, h: p.h }));
  return (
    <>
      {[...homes, ...houses].map((r, i) => (
        <div key={i} aria-hidden className="village-window pointer-events-none absolute" style={{ left: r.col * CELL, top: (r.row + r.h * 0.45) * CELL, width: r.w * CELL, height: r.h * 0.55 * CELL }} />
      ))}
    </>
  );
}
