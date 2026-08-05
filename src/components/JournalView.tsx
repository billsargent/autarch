"use client";

import { useCallback, useEffect, useState } from "react";
import type { JournalEntryRow } from "@/lib/agent/clientTypes";

const CATEGORY_ICON: Record<string, string> = {
  exploration: "🧭",
  task: "✅",
  reflection: "💭",
  idea: "💡",
  system: "🗒️",
};

const STATUS_STYLE: Record<string, string> = {
  open: "bg-neutral-800 text-neutral-300",
  in_progress: "bg-blue-900/50 text-blue-300",
  done: "bg-emerald-900/50 text-emerald-300",
  abandoned: "bg-red-900/40 text-red-300",
};

export default function JournalView() {
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/journal").then((r) => r.json());
    setEntries(res.entries || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 10000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  async function addNote() {
    if (!title.trim()) return;
    await fetch("/api/journal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body, category: "system", status: "open" }),
    });
    setTitle("");
    setBody("");
    load();
  }

  async function setStatus(id: number, status: string) {
    await fetch(`/api/journal/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function remove(id: number) {
    await fetch(`/api/journal/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-semibold">Agent journal</h1>
        <p className="mt-1 text-sm text-neutral-500">
          The agent logs what it&apos;s exploring, building, or thinking about here. This is the honest answer to
          &quot;what have you been up to?&quot;
        </p>

        <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="mb-2 text-xs font-semibold text-neutral-400">Add a human note / task for the agent</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Details (optional)"
            rows={2}
            className="mb-2 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
          />
          <button
            onClick={addNote}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            Add note
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {loading && <p className="text-sm text-neutral-500">Loading…</p>}
          {!loading && entries.length === 0 && (
            <p className="text-sm text-neutral-500">No journal entries yet — ask the agent what it&apos;s working on to get it started.</p>
          )}
          {entries.map((e) => (
            <div key={e.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {CATEGORY_ICON[e.category] || "🗒️"} {e.title}
                  </p>
                  {e.body && <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-400">{e.body}</p>}
                  <p className="mt-2 text-[10px] text-neutral-600">
                    #{e.id} · {e.category} · updated {new Date(e.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[e.status]}`}>
                    {e.status}
                  </span>
                  <div className="flex gap-1">
                    {e.status !== "done" && (
                      <button
                        onClick={() => setStatus(e.id, "done")}
                        className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] hover:bg-neutral-800"
                      >
                        mark done
                      </button>
                    )}
                    <button
                      onClick={() => remove(e.id)}
                      className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-neutral-800"
                    >
                      delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
