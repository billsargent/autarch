"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "./village.css";
import { villageFonts } from "./fonts";
import { OWNER_SPRITE, VILLAGE, interiorManifest, spriteFor } from "./manifest";
import { MOOD_BADGE, MOOD_PLACE, moodLabel, standOffsets, villagerMood } from "./villagerState";
import { snapshotOf, useVillageData } from "./useVillageData";
import StampSprite from "./StampSprite";
import { CELL, STAMPS, type StampId } from "./scene";
import { SHOP, placeDecor, type ShopItem } from "@/lib/agent/shop";
import SceneView, { type VillagerSpec } from "./SceneView";
import ApprovalPrompt from "./ApprovalPrompt";
import ParchmentDialog from "./ParchmentDialog";
import { ROOMS } from "./rooms";
import { useDeferredApprovals } from "./useDeferredApprovals";
import { useVillageClock } from "./useVillageClock";
import { PLOT_INTERIORS } from "./scenes";
import { useBuildings } from "../data/useBuildings";
import { TRADES, type TradeKey } from "@/lib/agent/trades";
import type { VillagerLife } from "@/lib/agent/clientTypes";

// A building's interior: the room's art, its furniture as hotspots, and the
// room's dialogs. Villagers are shown here only when what they're really doing
// puts them in this building. A cottage belongs to one villager (`agentId`):
// its dialogs are theirs, and it's where they relax.
// You, standing in the doorway (#109).
const OWNER = { name: "You", color: "#3b2716", sprite: OWNER_SPRITE, start: "door" };

// Inside a building on the plots (#154), villagers are there by their
// village life: at work in it, or (the tavern) spending the evening. Whoever
// works there stands at their spot.
const WORK_SPOT: Record<string, string> = { tavern: "bar", bakery: "oven", shop: "counter" };
function insidePlot(kind: string, life: VillagerLife | null | undefined): boolean {
  if (!life) return false;
  if (kind === "tavern" && life.place === "tavern") return true;
  return life.place === "work" && TRADES[life.trade as TradeKey]?.building === kind;
}

// What someone here is doing: their village life when they're about it
// ("Ruth is fishing at the river"), or else their mood.
function sayWhat(v: { name: string; life?: VillagerLife | null }, mood: Parameters<typeof moodLabel>[0]): string {
  return mood === "idle" && v.life?.activity ? `${v.name} is ${v.life.activity}` : moodLabel(mood, v.name);
}

// The last thing each villager said at the meeting going on, and who's
// speaking now (#83). Only polls while there's a meeting.
function useMeetingLines(on: boolean) {
  const [state, setState] = useState<{ lines: Record<string, string>; speaking: number | null }>({ lines: {}, speaking: null });
  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = async () => {
      try {
        const d = await fetch("/api/meetings", { cache: "no-store" }).then((r) => r.json());
        if (!live || !d.meeting) return;
        const lines: Record<string, string> = {};
        for (const t of d.transcript ?? []) if (t.who !== "You" && t.who !== "Meeting") lines[t.who] = t.text.length > 140 ? `${t.text.slice(0, 137)}…` : t.text;
        setState({ lines, speaking: d.meeting.speakingAgentId });
      } catch {
        /* try again next time */
      }
    };
    void load();
    const id = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [on]);
  return state;
}

// What a villager has bought for their cottage (#135), in its free slots.
function CottageDecor({ decor }: { decor: string[] }) {
  return (
    <>
      {placeDecor(decor).map((d, i) => {
        const stamp = (SHOP[d.item] as ShopItem).stamp as StampId | undefined;
        return stamp && stamp in STAMPS ? <StampSprite key={`${d.item}-${i}`} stamp={stamp} x={d.col * CELL} y={d.row * CELL} /> : null;
      })}
    </>
  );
}

export default function InteriorView({ sceneId, startAction, agentId }: { sceneId: string; startAction?: string; agentId?: number | null }) {
  const scene = interiorManifest(sceneId)!;
  const Room = ROOMS[sceneId];
  const building = VILLAGE.places.find((p) => p.interior === sceneId);
  const { data, refresh, mayor } = useVillageData();
  const isCottage = sceneId === "cottage";
  const owner = isCottage ? (data.villagers.find((v) => v.id === agentId) ?? mayor) : null;
  const title = owner ? `${owner.name}'s cottage` : scene.title;

  const { phase, night } = useVillageClock(data.bedtime, data.wakeTime, data.villageClock, data.villageDayHours);
  const moods = data.villagers.map((v) => ({ v, mood: villagerMood(snapshotOf(v, data.paused, night)) }));
  const plotKind = (PLOT_INTERIORS as readonly string[]).includes(sceneId) ? sceneId : null;
  const plots = useBuildings().state;
  const plot = plotKind ? plots?.buildings.find((b) => b.kind === plotKind && b.status === "built") : undefined;
  const riverside = sceneId === "riverside";
  const here = riverside
    ? // The riverside (#190): the fishers at work.
      moods.filter(({ v, mood }) => mood === "idle" && v.life?.place === "work" && v.life.trade === "fisher")
    : plotKind
    ? moods.filter(({ v, mood }) => mood === "idle" && insidePlot(plotKind, v.life))
    : isCottage
      ? // At home (#159): its owner asleep or at home, and any friend visiting them.
        moods.filter(
          ({ v, mood }) =>
            (v.id === owner?.id && (mood === "asleep" || (mood === "idle" && (!v.life || v.life.place === "home")))) ||
            (mood === "idle" && v.life?.place === "visit" && v.life.withId === owner?.id),
        )
      : moods.filter(({ v, mood }) => building && MOOD_PLACE[mood] === building.id);
  const atWork = (life: VillagerLife | null | undefined) => riverside || Boolean(plotKind && life?.place === "work" && WORK_SPOT[plotKind]);
  const away = owner && !here.some((h) => h.v.id === owner.id) ? moods.find((m) => m.v.id === owner.id) : null;

  // Which furniture's dialogs are open; `opened` remounts the room UI each time.
  const [action, setAction] = useState<string | null>(startAction ?? null);
  const [opened, setOpened] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deferred, setDeferred] = useDeferredApprovals();
  // In the town hall the clerk's desk is where approvals live, so the pop-up
  // stays away and "waiting" opens the desk instead.
  const atTownHall = sceneId === "townhall";
  const showPrompt = !atTownHall && data.pending.length > 0 && !data.pending.every((p) => deferred.includes(p.id));
  const nameOf = (id: number | null) => data.villagers.find((v) => v.id === id)?.name ?? mayor?.name ?? "A villager";

  function open(act: string | undefined) {
    if (!act) return;
    setMenuOpen(false);
    setAction(act);
    setOpened((n) => n + 1);
  }

  const center = scene.waypoints.find((w) => w.id === "center")?.id ?? scene.spawn;
  const offsets = standOffsets(here.map(() => center));
  // A town meeting (#83): those attending sit round the long table, each with
  // the last thing they said in a bubble.
  const meetingOn = sceneId === "townhall" && here.some((h) => h.mood === "meeting");
  const meeting = useMeetingLines(meetingOn);
  const seated = here.filter((h) => h.mood === "meeting").map((h) => h.v.id);
  const villagers: VillagerSpec[] = here.map(({ v, mood }, i) => ({
    id: `agent-${v.id}`,
    name: v.name,
    color: v.color,
    sprite: spriteFor(v.character),
    // Asleep at home, they're in bed (#111); at a meeting, at the table (#83).
    target: isCottage && mood === "asleep" ? "bed" : mood === "meeting" && seated.indexOf(v.id) < 6 ? `seat-${seated.indexOf(v.id) + 1}` : atWork(v.life) ? (riverside ? "jetty" : WORK_SPOT[plotKind!]) : center,
    // Fishers on the jetty stand side by side (#190); a keeper at their counter stands alone.
    offset: (isCottage && mood === "asleep") || (mood === "meeting" && seated.indexOf(v.id) < 6) || (atWork(v.life) && !riverside) ? 0 : offsets[i],
    said: mood === "meeting" ? (meeting.speaking === v.id ? "💬 …" : meeting.lines[v.name] ?? null) : (plotKind || riverside) && v.life ? v.life.activity : null,
    badge: MOOD_BADGE[mood],
    vest: v.tier === "worker",
    title: sayWhat(v, mood),
    asleep: mood === "asleep",
    lying: isCottage && mood === "asleep",
  }));

  const awayWhere = away ? VILLAGE.places.find((p) => p.id === MOOD_PLACE[away.mood]) : null;
  const note = here.length
    ? here.length > 3
      ? `${here.length} villagers are here: ${here.map(({ v }) => v.name).join(", ")}.`
      : here.map(({ v, mood }) => sayWhat(v, mood)).join(" · ")
    : away
      ? `${away.v.name} isn't home — ${awayWhere ? `they're at the ${awayWhere.label.toLowerCase()}` : "they're out"}.`
      : sceneId === "home"
        ? "Home sweet home. It's quiet."
        : plotKind && plots && !plot
          ? `There's no ${scene.title.replace(/^The /, "").toLowerCase()} standing in the village yet.`
        : "Nobody's here right now.";

  return (
    <div className={`${villageFonts} village-root flex h-full w-full flex-col`}>
      <div className="village-hud relative z-20 flex items-center gap-2 px-3 py-2">
        <Link href={building ? `/?from=${building.id}` : plot ? `/?from=${plot.plotId}` : "/"} className="village-btn px-3 py-1.5 text-xs" aria-label="Leave and go back to the village">
          ← Leave
        </Link>
        <h1 className="village-pixel min-w-0 flex-1 truncate text-sm text-[#fff6e0]">{title}</h1>
        {data.pending.length > 0 && (
          <button
            onClick={() => (atTownHall ? open("approvals.pending") : setDeferred([]))}
            className="village-btn village-btn-danger animate-pulse px-3 py-1.5 text-xs motion-reduce:animate-none">
            ❗ {data.pending.length} waiting
          </button>
        )}
        <button onClick={() => setMenuOpen(true)} className="village-btn px-3 py-1.5 text-xs" aria-haspopup="dialog">
          In this room
        </button>
      </div>

      <SceneView
        scene={scene}
        overlays={isCottage && owner?.life?.decor?.length ? <CottageDecor decor={owner.life.decor} /> : undefined}
        player={OWNER}
        light={data.paused ? "frozen" : phase}
        labels="hover"
        onPlace={(p) => open(p.action)}
        hints={<span>click the furniture, or walk up and press <kbd className="font-bold">Space</kbd></span>}
        villagers={villagers}
      >
        <p className="pointer-events-none absolute left-3 top-3 z-10 max-w-[70%] rounded border-2 border-[#3b2716] bg-[#f4ead5]/90 px-2 py-1 text-xs">
          {note}
        </p>

        {menuOpen && (
          <ParchmentDialog kicker={title} title="In this room" onClose={() => setMenuOpen(false)}>
            <ul className="space-y-2">
              {scene.places
                .filter((p) => p.action)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => open(p.action)}
                      className="w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2 text-left hover:bg-white"
                    >
                      <span className="village-pixel block text-sm">{p.label}</span>
                      <span className="block text-xs text-[#6b4a2e]">{p.role}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </ParchmentDialog>
        )}

        {Room && action && <Room key={opened} action={action} agentId={owner?.id ?? null} onClose={() => setAction(null)} />}

        {showPrompt && (
          <ApprovalPrompt
            nameOf={(p) => nameOf(p.agentId)}
            pending={data.pending.filter((p) => !deferred.includes(p.id))}
            onDecided={() => void refresh()}
            onLater={() => setDeferred(data.pending.map((p) => p.id))}
          />
        )}
      </SceneView>
    </div>
  );
}
