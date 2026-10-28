"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FALLBACK_MS, useLive } from "./useLive";

// The village's plots and buildings (#105), its stores (#106), and how many
// it has room for.

export type BuildingKind = "house" | "farm" | "mill" | "bakery" | "workshop" | "tavern" | "shop" | "garden";

export interface BuildingRow {
  id: number;
  // "land" clears the next ring of the village (plotId "ring-<n>").
  kind: BuildingKind | "land";
  plotId: string;
  status: "proposed" | "building" | "built" | "declined";
  proposedBy: number | null;
  readyAt: string | null;
  keeperId: number | null;
}

export interface BuildingsState {
  plots: string[];
  kinds: Record<BuildingKind, { label: string; beds: number; stamp: string; morale: number; cost: number }>;
  buildings: BuildingRow[];
  // The stores (#106, #132) and the treasury and good name (#136).
  economy: { wheat: number; flour: number; bread: number; fish: number; flowers: number; crafts: number; ale: number; treasury: number; reputation: number; shortage: number; lastTickDay: string | null };
  keepers: Record<string, string>;
  room: number;
  // How far the land reaches (0 = the first ring), and why the next ring
  // can't be cleared yet (null = it can).
  level: number;
  maxLevel: number;
  landBlocked: string | null;
}

export function useBuildings(pollMs = 20000) {
  const [state, setState] = useState<BuildingsState | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await fetch("/api/buildings", { cache: "no-store" }).then((r) => r.json());
      if (mine === seq.current && data.plots) setState(data);
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
  useLive(["building", "agent"], reload);

  const send = useCallback(
    async (url: string, method: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        await reload();
        return res.ok ? { ok: true } : { ok: false, error: data.error || `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [reload],
  );

  return {
    state,
    reload,
    build: (kind: BuildingKind, plotId: string) => send("/api/buildings", "POST", { kind, plotId }),
    clearLand: () => send("/api/buildings", "POST", { kind: "land" }),
    decide: (id: number, action: "approve" | "decline") => send(`/api/buildings/${id}`, "PATCH", { action }),
    setKeeper: (id: number, agentId: number | null) => send(`/api/buildings/${id}`, "PATCH", { action: "keeper", agentId }),
  };
}
