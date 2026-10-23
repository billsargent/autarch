"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentRow, ToolExecutionRow } from "@/lib/agent/clientTypes";

export interface VillageData {
  loaded: boolean;
  // The whole village is paused ("Lights out").
  paused: boolean;
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
        getJson<{ settings: { paused: boolean } }>("/api/settings"),
        getJson<{ today: { costUsd: number } }>("/api/stats"),
        getJson<{ goals: Array<{ status: string }> }>("/api/goals"),
        getJson<{ unread: unknown[] }>("/api/notifications"),
      ]);
      setData({
        loaded: true,
        paused: Boolean(settings.settings?.paused),
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
    const id = setInterval(refresh, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const mayor = data.villagers.find((v) => v.isMayor) ?? data.villagers[0] ?? null;
  return { data, refresh, mayor };
}

// What a villager is doing, from their own state and the village's.
export function snapshotOf(v: AgentRow, villagePaused: boolean) {
  return { paused: villagePaused || v.status === "paused", running: v.working, pendingApprovals: v.waiting };
}
