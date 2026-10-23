"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationRow, MessageRow, ToolExecutionRow } from "@/lib/agent/clientTypes";

export interface VillageData {
  loaded: boolean;
  agentName: string;
  paused: boolean;
  running: boolean;
  // Conversation the agent is busy in, else the most recently active one.
  focusConversationId: number | null;
  conversations: Array<Pick<ConversationRow, "id" | "title">>;
  pending: ToolExecutionRow[];
  spentToday: number;
  openGoals: number;
  unread: number;
  lastSaid: string | null;
  // When it was said (ms since epoch), so the bubble can fade after a while.
  lastSaidAt: number | null;
}

const EMPTY: VillageData = {
  loaded: false,
  agentName: "Agent",
  paused: false,
  running: false,
  focusConversationId: null,
  conversations: [],
  pending: [],
  spentToday: 0,
  openGoals: 0,
  unread: 0,
  lastSaid: null,
  lastSaidAt: null,
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
      const [convos, approvals, settings, stats, goals, notifs] = await Promise.all([
        getJson<{ conversations: ConversationRow[] }>("/api/conversations"),
        getJson<{ pending: ToolExecutionRow[] }>("/api/approvals"),
        getJson<{ settings: { agentName: string; paused: boolean } }>("/api/settings"),
        getJson<{ today: { costUsd: number } }>("/api/stats"),
        getJson<{ goals: Array<{ status: string }> }>("/api/goals"),
        getJson<{ unread: unknown[] }>("/api/notifications"),
      ]);
      const list = convos.conversations ?? [];
      const busy = list.find((c) => c.running);
      const focus = busy ?? list[0] ?? null;

      let lastSaid: string | null = null;
      let lastSaidAt: number | null = null;
      if (focus) {
        const detail = await getJson<{ messages: MessageRow[] }>(`/api/conversations/${focus.id}?limit=8`);
        const said = [...(detail.messages ?? [])].reverse().find((m) => m.role === "assistant" && m.content?.trim());
        lastSaid = said?.content?.trim() ?? null;
        lastSaidAt = said?.createdAt ? new Date(said.createdAt).getTime() : null;
      }

      setData({
        loaded: true,
        agentName: settings.settings?.agentName || "Agent",
        paused: Boolean(settings.settings?.paused),
        running: Boolean(busy),
        focusConversationId: focus?.id ?? null,
        conversations: list.map((c) => ({ id: c.id, title: c.title })),
        pending: approvals.pending ?? [],
        spentToday: Number(stats.today?.costUsd ?? 0),
        openGoals: (goals.goals ?? []).filter((g) => g.status === "backlog" || g.status === "in_progress").length,
        unread: notifs.unread?.length ?? 0,
        lastSaid,
        lastSaidAt,
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

  return { data, refresh };
}
