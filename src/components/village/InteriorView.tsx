"use client";

import { useState } from "react";
import Link from "next/link";
import "./village.css";
import { villageFonts } from "./fonts";
import { AGENT_CHARACTER, AGENT_COLORS, CHARACTERS, VILLAGE, interiorManifest } from "./manifest";
import { MOOD_BADGE, MOOD_PLACE, moodLabel, villagerMood } from "./villagerState";
import { useVillageData } from "./useVillageData";
import SceneView, { type VillagerSpec } from "./SceneView";
import ApprovalPrompt from "./ApprovalPrompt";
import ParchmentDialog from "./ParchmentDialog";
import { ROOMS } from "./rooms";
import { useDeferredApprovals } from "./useDeferredApprovals";

// A building's interior: the room's art, its furniture as hotspots, and the
// room's dialogs. The agent is shown here only when its real state puts it in
// this building.
export default function InteriorView({ sceneId }: { sceneId: string }) {
  const scene = interiorManifest(sceneId)!;
  const Room = ROOMS[sceneId];
  const building = VILLAGE.places.find((p) => p.interior === sceneId);
  const { data, refresh } = useVillageData();

  const mood = villagerMood({ paused: data.paused, running: data.running, pendingApprovals: data.pending.length });
  const agentHere = building && MOOD_PLACE[mood] === building.id;
  const agentWhere = VILLAGE.places.find((p) => p.id === MOOD_PLACE[mood]);

  // Which furniture's dialogs are open; `opened` remounts the room UI each time.
  const [action, setAction] = useState<string | null>(null);
  const [opened, setOpened] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deferred, setDeferred] = useDeferredApprovals();
  // In the town hall the clerk's desk is where approvals live, so the pop-up
  // stays away and "waiting" opens the desk instead.
  const atTownHall = sceneId === "townhall";
  const showPrompt = !atTownHall && data.pending.length > 0 && !data.pending.every((p) => deferred.includes(p.id));

  function open(act: string | undefined) {
    if (!act) return;
    setMenuOpen(false);
    setAction(act);
    setOpened((n) => n + 1);
  }

  const villagers: VillagerSpec[] = agentHere
    ? [
        {
          id: "agent",
          name: data.agentName,
          color: AGENT_COLORS[0],
          sprite: CHARACTERS[AGENT_CHARACTER],
          target: scene.waypoints.find((w) => w.id === "center")?.id ?? scene.spawn,
          badge: MOOD_BADGE[mood],
          title: moodLabel(mood, data.agentName),
          asleep: mood === "asleep",
        },
      ]
    : [];

  return (
    <div className={`${villageFonts} village-root flex h-full w-full flex-col`}>
      <div className="village-hud relative z-20 flex items-center gap-2 px-3 py-2">
        <Link href="/village" className="village-btn px-3 py-1.5 text-xs" aria-label="Leave and go back to the village">
          ← Leave
        </Link>
        <h1 className="village-pixel min-w-0 flex-1 truncate text-sm text-[#fff6e0]">{scene.title}</h1>
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
        night={data.paused}
        labels="hover"
        onPlace={(p) => open(p.action)}
        hints={<span>click the furniture</span>}
        villagers={villagers}
      >
        <p className="pointer-events-none absolute left-3 top-3 z-10 max-w-[70%] rounded border-2 border-[#3b2716] bg-[#f4ead5]/90 px-2 py-1 text-xs">
          {agentHere
            ? moodLabel(mood, data.agentName)
            : mood === "idle"
              ? `${data.agentName} isn't here — they're out and about in the village.`
              : `${data.agentName} isn't here — ${agentWhere ? `they're at the ${agentWhere.label.toLowerCase()}` : "they're out"}.`}
        </p>

        {menuOpen && (
          <ParchmentDialog kicker={scene.title} title="In this room" onClose={() => setMenuOpen(false)}>
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

        {Room && action && <Room key={opened} action={action} onClose={() => setAction(null)} />}

        {showPrompt && (
          <ApprovalPrompt
            agentName={data.agentName}
            pending={data.pending.filter((p) => !deferred.includes(p.id))}
            onDecided={() => void refresh()}
            onLater={() => setDeferred(data.pending.map((p) => p.id))}
          />
        )}
      </SceneView>
    </div>
  );
}
