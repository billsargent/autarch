"use client";

import { useCallback, useEffect, useState } from "react";
import type { GoalRow } from "@/lib/agent/clientTypes";

const GOAL_STATUSES = ["backlog", "in_progress", "done", "abandoned"] as const;
const STATUS_STYLE: Record<string, string> = {
  backlog: "text-neutral-400",
  in_progress: "text-blue-300",
  done: "text-emerald-400",
  abandoned: "text-rose-400",
};

export default function GoalsView() {
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState(3);

  const load = useCallback(async () => {
    const res = await fetch("/api/goals").then((r) => r.json());
    setGoals(res.goals || []);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  async function createGoal() {
    if (!title.trim()) return;
    await fetch("/api/goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body, priority }),
    });
    setTitle("");
    setBody("");
    await load();
  }

  async function update(id: number, patch: Partial<GoalRow>) {
    await fetch(`/api/goals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
  }

  async function remove(id: number) {
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-semibold">Goals board</h1>
        <p className="mt-1 text-sm text-neutral-500">
          The agent&apos;s own goals. It reads these at the start of every work window to decide what to work on, and can
          create/update them itself via its <code className="text-neutral-400">manage_goal</code> tools.
        </p>

        <section className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold">Add a goal</h2>
          <div className="mt-3 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Goal title, e.g. 'Build a local dashboard for my metrics'"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Notes / details (optional)"
              rows={2}
              className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-400">
                Priority (1 = highest)
                <input
                  type="number"
                  value={priority}
                  min={1}
                  max={5}
                  onChange={(e) => setPriority(Number(e.target.value) || 3)}
                  className="ml-2 w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm outline-none"
                />
              </label>
              <button
                onClick={createGoal}
                disabled={!title.trim()}
                className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Add goal
              </button>
            </div>
          </div>
        </section>

        <div className="mt-5 space-y-3">
          {goals.length === 0 && (
            <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-500">
              No goals yet. Add some, or ask the agent to propose some.
            </p>
          )}
          {goals.map((g) => (
            <div key={g.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-100">
                    <span className="mr-2 text-[10px] uppercase text-neutral-500">p{g.priority}</span>
                    {g.title}
                  </p>
                  {g.body && <p className="mt-1 text-xs text-neutral-400">{g.body}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    value={g.status}
                    onChange={(e) => update(g.id, { status: e.target.value as GoalRow["status"] })}
                    className={`rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[11px] font-semibold outline-none ${STATUS_STYLE[g.status]}`}
                  >
                    {GOAL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => remove(g.id)}
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-[11px] text-red-400 hover:bg-red-950/30"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
