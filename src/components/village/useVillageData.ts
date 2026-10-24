"use client";

import { useCallback, useEffect, useState } from "react";
import { FALLBACK_MS, useLive } from "../data/useLive";
import type { AgentRow, ToolExecutionRow } from "@/lib/agent/clientTypes";

export interface VillageData {
  loaded: boolean;
  // The whole village is paused ("Pause everyone").
  paused: boolean;
  bedtime: string;
  wakeTime: string;
  // The villagers and what each is up to (#55).
  villagers: AgentRow[];
  pending: ToolExecutionRow[];
  spentToday: number;
  openGoals: number;
  unread: number;
}

const EMPTY: VillageData = {
  loaded: false,
  paused: false,
  bedtime: "22:00",
  wakeTime: "07:00",
  villagers: [],
  pending: [],
  spentToday: 0,
  openGoals: 0,
  unread: 0,
};

const POLL_MS = 5000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// Polls the existing endpoints for everything the village shows. Temporary:
// replaced by the live event stream (#74) once it exists.
export function useVillageData() {
  const [data, setData] = useState<VillageData>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const [agents, approvals, settings, stats, goals, notifs] = await Promise.all([
        getJson<{ agents: AgentRow[] }>("/api/agents"),
        getJson<{ pending: ToolExecutionRow[] }>("/api/approvals"),
        getJson<{ settings: { paused: boolean; bedtime: string; wakeTime: string } }>("/api/settings"),
        getJson<{ today: { costUsd: number } }>("/api/stats"),
        getJson<{ goals: Array<{ status: string }> }>("/api/goals"),
        getJson<{ unread: unknown[] }>("/api/notifications"),
      ]);
      setData({
        loaded: true,
        paused: Boolean(settings.settings?.paused),
        bedtime: settings.settings?.bedtime ?? "22:00",
        wakeTime: settings.settings?.wakeTime ?? "07:00",
        villagers: agents.agents ?? [],
        pending: approvals.pending ?? [],
        spentToday: Number(stats.today?.costUsd ?? 0),
        openGoals: (goals.goals ?? []).filter((g) => g.status === "backlog" || g.status === "in_progress").length,
        unread: notifs.unread?.length ?? 0,
      });
    } catch {
      // Keep showing the last known state; the next poll will retry.
      setData((prev) => ({ ...prev, loaded: true }));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, Math.max(POLL_MS, FALLBACK_MS));
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);
  // Live: the village redraws when anything it shows changes (#74).
  useLive(["agent", "session", "tool", "notification", "goal", "settings", "meeting", "message"], refresh, { debounceMs: 800 });

  const mayor = data.villagers.find((v) => v.isMayor) ?? data.villagers[0] ?? null;
  return { data, refresh, mayor };
}

// What a villager is doing, from their own state and the village's.
export function snapshotOf(v: AgentRow, villagePaused: boolean, night = false) {
  return { paused: villagePaused || v.status === "paused", running: v.working, pendingApprovals: v.waiting, night, meeting: Boolean(v.inMeeting) };
}
