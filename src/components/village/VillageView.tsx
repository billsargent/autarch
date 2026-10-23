"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "./village.css";
import { villageFonts } from "./fonts";
import { VILLAGE, spriteFor, type Place } from "./manifest";
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

export default function VillageView() {
  const router = useRouter();
  const { data, refresh, mayor } = useVillageData();
  const villagers = data.villagers;
  // Real local time sets the light and puts villagers to bed (#100); the
  // same tick fades speech bubbles.
  const { now: clock, time, phase, night } = useVillageClock(data.bedtime, data.wakeTime);

  // Idle villagers stroll between hangouts (plaza, market, gates, home…), each
  // on their own timer: a first walk within a few seconds, then every 20–50 s.
  // Working, waiting and sleeping keep a villager at their building.
  const [strolls, setStrolls] = useState<Record<number, string | null>>({});
  const idleIds = villagers.filter((v) => villagerMood(snapshotOf(v, data.paused, night)) === "idle").map((v) => v.id);
  const idleKey = idleIds.join(",");
  useEffect(() => {
    const ids = idleKey ? idleKey.split(",").map(Number) : [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const id of ids) {
      const wander = (delay: number) => {
        timers.push(
          setTimeout(() => {
            setStrolls((cur) => ({ ...cur, [id]: nextHangout(cur[id] ?? null, VILLAGE.hangouts, Math.random()) }));
            wander(20_000 + Math.random() * 30_000);
          }, delay),
        );
      };
      wander(3_000 + Math.random() * 6_000);
    }
    return () => timers.forEach(clearTimeout);
  }, [idleKey]);

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
    const home = VILLAGE.places.find((p) => p.id === MOOD_PLACE[mood]) ?? VILLAGE.places[0];
    const stroll = mood === "idle" ? strolls[v.id] : null;
    const target = stroll ?? home.door;
    return { v, mood, target, strolling: mood === "idle" && target !== home.door };
  });
  const offsets = standOffsets(plans.map((p) => p.target));
  const specs: VillagerSpec[] = plans.map(({ v, mood, target, strolling }, i) => ({
    id: `agent-${v.id}`,
    name: v.name,
    color: v.color,
    sprite: spriteFor(v.character),
    target,
    offset: offsets[i],
    badge: MOOD_BADGE[mood],
    title: `${moodLabel(mood, v.name, strolling)} — click to talk`,
    said: v.lastSaid && v.lastSaidAt && clock - v.lastSaidAt < BUBBLE_MS ? bubbleLine(v.lastSaid) : null,
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
      />

      <SceneView
        scene={VILLAGE}
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
