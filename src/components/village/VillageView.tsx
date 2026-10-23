"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "./village.css";
import { villageFonts } from "./fonts";
import { AGENT_CHARACTER, AGENT_COLORS, CHARACTERS, VILLAGE, type Place } from "./manifest";
import { BUBBLE_MS, MOOD_BADGE, MOOD_PLACE, bubbleLine, moodLabel, nextHangout, villagerMood } from "./villagerState";
import { useVillageData } from "./useVillageData";
import SceneView from "./SceneView";
import VillageHud from "./VillageHud";
import TalkDrawer from "./TalkDrawer";
import ApprovalPrompt from "./ApprovalPrompt";
import { ROOMS } from "./rooms";
import { useDeferredApprovals } from "./useDeferredApprovals";

export default function VillageView() {
  const router = useRouter();
  const { data, refresh } = useVillageData();
  const color = AGENT_COLORS[0];

  const mood = villagerMood({ paused: data.paused, running: data.running, pendingApprovals: data.pending.length });
  const home = VILLAGE.places.find((p) => p.id === MOOD_PLACE[mood]) ?? VILLAGE.places[0];

  // An idle villager strolls between hangouts (plaza, market, gates, home…):
  // the first walk within a few seconds, then every 20–50 s. Working, waiting
  // and sleeping keep it at its building.
  const [stroll, setStroll] = useState<string | null>(null);
  useEffect(() => {
    if (mood !== "idle") return;
    let timer: ReturnType<typeof setTimeout>;
    const wander = (delay: number) => {
      timer = setTimeout(() => {
        setStroll((cur) => nextHangout(cur, VILLAGE.hangouts, Math.random()));
        wander(20_000 + Math.random() * 30_000);
      }, delay);
    };
    wander(3_000 + Math.random() * 4_000);
    return () => clearTimeout(timer);
  }, [mood]);
  const target = mood === "idle" && stroll ? stroll : home.door;
  const strolling = mood === "idle" && target !== home.door;

  // The speech bubble shows the last thing said, briefly, then fades.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const said =
    data.lastSaid && data.lastSaidAt && clock - data.lastSaidAt < BUBBLE_MS ? bubbleLine(data.lastSaid) : null;

  // Drawers, prompts, and the dialogs of outdoor things (the notice board).
  const [talking, setTalking] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [opened, setOpened] = useState(0);
  const VillageRoom = ROOMS.village;
  const [deferred, setDeferred] = useDeferredApprovals();
  const showPrompt = data.pending.length > 0 && !data.pending.every((p) => deferred.includes(p.id));
  const promptQueue = data.pending.filter((p) => !deferred.includes(p.id));

  const togglePause = useCallback(async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: !data.paused }),
    }).catch(() => {});
    await refresh();
  }, [data.paused, refresh]);

  // Keyboard: T talk, Esc close. (Zoom keys live in SceneView.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.key === "t" || e.key === "T") setTalking(true);
      else if (e.key === "Escape") setTalking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openAction(act: string) {
    setTalking(false);
    setAction(act);
    setOpened((n) => n + 1);
  }

  function openPlace(p: Place) {
    if (p.interior) router.push(`/village/${p.interior}`);
    else if (p.action) openAction(p.action);
    else if (p.href) router.push(p.href);
  }

  return (
    <div className={`${villageFonts} village-root flex h-full w-full flex-col`}>
      <VillageHud
        villagers={1}
        working={mood === "working" ? 1 : 0}
        waiting={data.pending.length}
        openGoals={data.openGoals}
        spentToday={data.spentToday}
        unread={data.unread}
        paused={data.paused}
        onShowApprovals={() => setDeferred([])}
        onTogglePause={togglePause}
        onShowMail={() => openAction("mail.open")}
      />

      <SceneView
        scene={VILLAGE}
        night={data.paused}
        labels="signs"
        onPlace={openPlace}
        hints={
          <>
            <span><kbd className="font-bold">T</kbd> talk</span>
            <span>drag to pan</span>
          </>
        }
        villagers={[
          {
            id: "agent",
            name: data.agentName,
            color,
            sprite: CHARACTERS[AGENT_CHARACTER],
            target,
            badge: MOOD_BADGE[mood],
            title: `${moodLabel(mood, data.agentName, strolling)} — click to talk`,
            said,
            asleep: mood === "asleep",
            hint: (
              <>
                <kbd className="font-bold">T</kbd> talk
              </>
            ),
            onClick: () => setTalking(true),
          },
        ]}
      >
        {!talking && data.loaded && (
          <button onClick={() => setTalking(true)} className="village-btn absolute bottom-4 left-1/2 z-10 -translate-x-1/2 px-3 py-1.5 text-xs sm:hidden">
            <kbd className="mr-2 rounded border border-[#3b2716] bg-[#f4ead5] px-1 text-[#3b2716]">T</kbd>
            Talk to {data.agentName}
          </button>
        )}

        <p className="pointer-events-none absolute left-3 top-3 z-10 max-w-[60%] rounded border-2 border-[#3b2716] bg-[#f4ead5]/90 px-2 py-1 text-xs">
          {moodLabel(mood, data.agentName, strolling)}
        </p>

        {talking && (
          <TalkDrawer
            agentName={data.agentName}
            color={color}
            conversations={data.conversations}
            initialConversationId={data.focusConversationId}
            onClose={() => setTalking(false)}
          />
        )}

        {VillageRoom && action && <VillageRoom key={opened} action={action} onClose={() => setAction(null)} />}

        {showPrompt && (
          <ApprovalPrompt
            agentName={data.agentName}
            pending={promptQueue}
            onDecided={() => void refresh()}
            onLater={() => setDeferred(data.pending.map((p) => p.id))}
          />
        )}
      </SceneView>
    </div>
  );
}
