"use client";

import { useCallback, useEffect, useState } from "react";
import type { JournalEntryRow } from "@/lib/agent/clientTypes";

// The agent's journal: what it has been exploring, building and thinking.
// Shared by the Journal page and the diary in the cottage.

export const JOURNAL_ICON: Record<string, string> = {
  exploration: "🧭",
  task: "✅",
  reflection: "💭",
  idea: "💡",
  system: "🗒️",
};

export function useJournal() {
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/journal").then((r) => r.json());
    setEntries(res.entries || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    const id = setInterval(reload, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload]);

  // A note or task from the human for the agent to see.
  const addNote = useCallback(
    async (title: string, body: string) => {
      if (!title.trim()) return;
      await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body, category: "system", status: "open" }),
      });
      await reload();
    },
    [reload],
  );

  const setStatus = useCallback(
    async (id: number, status: JournalEntryRow["status"]) => {
      await fetch(`/api/journal/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await reload();
    },
    [reload],
  );

  // Delete an entry. Callers confirm with the human first.
  const remove = useCallback(
    async (id: number) => {
      await fetch(`/api/journal/${id}`, { method: "DELETE" });
      await reload();
    },
    [reload],
  );

  return { entries, loaded, reload, addNote, setStatus, remove };
}
