"use client";

import { useCallback, useEffect, useState } from "react";
import { FALLBACK_MS, useLive } from "./useLive";
import type { AgentRow } from "@/lib/agent/clientTypes";

// The villagers (#55) and what they're up to. Used by the village, the rooms
// and the Mayor's ledger.

export type VillagerInput = Partial<
  Pick<AgentRow, "name" | "role" | "persona" | "character" | "color" | "model" | "enabledTools" | "dailyBudgetUsd" | "maxActionsPerHour" | "status" | "tier" | "area" | "managerId" | "daydream" | "providerId">
>;

export type VillagerResult = { ok: true; agent?: AgentRow } | { ok: false; error: string };

async function send(url: string, method: string, body?: unknown): Promise<VillagerResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, agent: data.agent } : { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function useVillagers(pollMs = 5000) {
  const [villagers, setVillagers] = useState<AgentRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/agents").then((r) => r.json());
      setVillagers(res.agents || []);
      setLoaded(true);
    } catch {
      /* keep what we have */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    const id = setInterval(reload, Math.max(FALLBACK_MS, pollMs));
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload, pollMs]);
  // Live: refresh when something it shows changes (#74).
  useLive(["agent", "session", "tool", "meeting", "job"], reload);

  const add = useCallback(
    async (input: VillagerInput) => {
      const res = await send("/api/agents", "POST", input);
      await reload();
      return res;
    },
    [reload],
  );

  const update = useCallback(
    async (id: number, patch: VillagerInput) => {
      const res = await send(`/api/agents/${id}`, "PATCH", patch);
      await reload();
      return res;
    },
    [reload],
  );

  // The villager leaves the village. Callers confirm with the human first.
  const dismiss = useCallback(
    async (id: number) => {
      const res = await send(`/api/agents/${id}`, "DELETE");
      await reload();
      return res;
    },
    [reload],
  );

  const mayor = villagers.find((v) => v.isMayor) ?? villagers[0] ?? null;
  const byId = (id: number | null | undefined) => villagers.find((v) => v.id === id) ?? null;

  return { villagers, loaded, reload, add, update, dismiss, mayor, byId };
}
