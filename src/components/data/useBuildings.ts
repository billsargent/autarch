"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The village's plots and buildings (#105), its stores (#106), and how many
// it has room for.

export type BuildingKind = "house" | "farm" | "bakery" | "workshop";

export interface BuildingRow {
  id: number;
  kind: BuildingKind;
  plotId: string;
  status: "proposed" | "building" | "built" | "declined";
  proposedBy: number | null;
  readyAt: string | null;
  keeperId: number | null;
}

export interface BuildingsState {
  plots: string[];
  kinds: Record<BuildingKind, { label: string; beds: number; stamp: string }>;
  buildings: BuildingRow[];
  economy: { wheat: number; bread: number; shortage: number; lastTickDay: string | null };
  keepers: Record<string, string>;
  room: number;
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
    const id = setInterval(reload, pollMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload, pollMs]);

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
    decide: (id: number, action: "approve" | "decline") => send(`/api/buildings/${id}`, "PATCH", { action }),
    setKeeper: (id: number, agentId: number | null) => send(`/api/buildings/${id}`, "PATCH", { action: "keeper", agentId }),
  };
}
