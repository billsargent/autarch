"use client";

import { useState } from "react";
import Link from "next/link";
import "./village.css";
import { villageFonts } from "./fonts";
import { VILLAGE, interiorManifest, spriteFor } from "./manifest";
import { MOOD_BADGE, MOOD_PLACE, moodLabel, standOffsets, villagerMood } from "./villagerState";
import { snapshotOf, useVillageData } from "./useVillageData";
import SceneView, { type VillagerSpec } from "./SceneView";
import ApprovalPrompt from "./ApprovalPrompt";
import ParchmentDialog from "./ParchmentDialog";
import { ROOMS } from "./rooms";
import { useDeferredApprovals } from "./useDeferredApprovals";
import { useVillageClock } from "./useVillageClock";

// A building's interior: the room's art, its furniture as hotspots, and the
// room's dialogs. Villagers are shown here only when what they're really doing
// puts them in this building. A cottage belongs to one villager (`agentId`):
// its dialogs are theirs, and it's where they relax.
export default function InteriorView({ sceneId, startAction, agentId }: { sceneId: string; startAction?: string; agentId?: number | null }) {
  const scene = interiorManifest(sceneId)!;
  const Room = ROOMS[sceneId];
  const building = VILLAGE.places.find((p) => p.interior === sceneId);
  const { data, refresh, mayor } = useVillageData();
  const isCottage = sceneId === "cottage";
  const owner = isCottage ? (data.villagers.find((v) => v.id === agentId) ?? mayor) : null;
  const title = owner ? `${owner.name}'s cottage` : scene.title;

  const { phase, night } = useVillageClock(data.bedtime, data.wakeTime);
  const moods = data.villagers.map((v) => ({ v, mood: villagerMood(snapshotOf(v, data.paused, night)) }));
  const here = moods.filter(({ v, mood }) => building && MOOD_PLACE[mood] === building.id && (!isCottage || v.id === owner?.id));
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
  const villagers: VillagerSpec[] = here.map(({ v, mood }, i) => ({
    id: `agent-${v.id}`,
    name: v.name,
    color: v.color,
    sprite: spriteFor(v.character),
    target: center,
    offset: offsets[i],
    badge: MOOD_BADGE[mood],
    vest: v.tier === "worker",
    title: moodLabel(mood, v.name),
    asleep: mood === "asleep",
  }));

  const awayWhere = away ? VILLAGE.places.find((p) => p.id === MOOD_PLACE[away.mood]) : null;
  const note = here.length
    ? here.map(({ v, mood }) => moodLabel(mood, v.name)).join(" · ")
    : away
      ? `${away.v.name} isn't home — ${awayWhere ? `they're at the ${awayWhere.label.toLowerCase()}` : "they're out"}.`
      : "Nobody's here right now.";

  return (
    <div className={`${villageFonts} village-root flex h-full w-full flex-col`}>
      <div className="village-hud relative z-20 flex items-center gap-2 px-3 py-2">
        <Link href="/" className="village-btn px-3 py-1.5 text-xs" aria-label="Leave and go back to the village">
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
        light={data.paused ? "frozen" : phase}
        labels="hover"
        onPlace={(p) => open(p.action)}
        hints={<span>click the furniture</span>}
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
