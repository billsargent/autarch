"use client";

import { useCallback, useEffect, useState } from "react";
import { FALLBACK_MS, useLive } from "./useLive";
import type { ToolExecutionRow } from "@/lib/agent/clientTypes";

// Actions waiting on the human, and recent decisions. Shared by the
// Approvals page and the town hall.

export type Decision = "approved" | "denied";
export type DecideResult = { ok: true } | { ok: false; error: string };

// "key: value" lines for a tool's input, or null when there's nothing to show.
export function formatToolInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length) return null;
  return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
}

export function useApprovals() {
  const [pending, setPending] = useState<ToolExecutionRow[]>([]);
  const [recent, setRecent] = useState<ToolExecutionRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/approvals").then((r) => r.json());
    setPending(res.pending || []);
    setRecent(res.recent || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    const id = setInterval(reload, FALLBACK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload]);
  // Live: refresh when something it shows changes (#74).
  useLive(["tool"], reload);

  // Approve or deny one request. The note is shown to the agent.
  const decide = useCallback(
    async (id: number, decision: Decision, note?: string): Promise<DecideResult> => {
      try {
        const res = await fetch(`/api/approvals/${id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, note }),
        });
        const data = await res.json().catch(() => ({}));
        return res.ok ? { ok: true } : { ok: false, error: data.error || `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        await reload();
      }
    },
    [reload],
  );

  // Decisions already made, newest first.
  const decided = recent.filter((r) => r.status !== "awaiting_approval");

  return { pending, recent, decided, loaded, reload, decide };
}
