"use client";

import { useCallback, useEffect, useState } from "react";
import { FALLBACK_MS, useLive } from "./useLive";
import type { HireRequestRow } from "@/lib/agent/clientTypes";

// Hire requests (#99) for the clerk's desk: waiting ones first, then recent
// decisions. Approving can carry the owner's edits to the draft.
export function useHires(pollMs = 10000) {
  const [requests, setRequests] = useState<HireRequestRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/hires").then((r) => r.json());
      setRequests(res.requests || []);
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
  useLive(["hire", "agent"], reload);

  const decide = useCallback(
    async (id: number, action: "approve" | "decline", draft?: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch(`/api/hires/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, draft }),
        });
        const data = await res.json().catch(() => ({}));
        await reload();
        return res.ok ? { ok: true } : { ok: false, error: data.error || `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [reload],
  );

  const waiting = requests.filter((r) => r.status === "awaiting_owner" || r.status === "interviewing");
  return { requests, waiting, loaded, decide };
}
