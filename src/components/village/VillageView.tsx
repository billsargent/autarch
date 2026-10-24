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
  const [savedLevel] = useState(() => (typeof window === "undefined" ? 0 : rememberedLevel()));
  const level = Math.min(VILLAGE_MANIFESTS.length - 1, buildings.state?.level ?? savedLevel);
  const scene = VILLAGE_MANIFESTS[level];
  useEffect(() => {
    try {
      window.localStorage.setItem(LEVEL_KEY, String(level));
    } catch {
      /* private window: fine */
    }
  }, [level]);
  const [player] = useState<PlayerSpec>(() => ({ name: "You", color: "#3b2716", sprite: OWNER_SPRITE, start: startingDoor() }));
  // ?open=<action> opens an outdoor dialog straight away (the notice board, the mailbox).
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open && ["goals.board", "goals.new", "mail.open"].includes(open)) {
      const t = setTimeout(() => openAction(open), 0);
      return () => clearTimeout(t);
    }
  }, []);
  const router = useRouter();
  const { data, refresh, mayor } = useVillageData();
  const villagers = data.villagers;
  // Real local time sets the light and puts villagers to bed (#100); the
  // same tick fades speech bubbles.
  const { now: clock, time, phase, night } = useVillageClock(data.bedtime, data.wakeTime);
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
    // A keeper with nothing else on is at their farm or bakery (#106).
    const keeps = mood === "idle" ? scene.plots.find((p) => p.id === buildings.state?.keepers[v.id]) : undefined;
    const stroll = mood === "idle" && !keeps ? strolls[v.id] : null;
    const target = keeps?.door ?? stroll ?? home.door;
    return { v, mood, target, strolling: mood === "idle" && !keeps && target !== home.door };
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
            : null,
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
            .join(" · ") || `${plans.length} villagers relaxing at home`;

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
