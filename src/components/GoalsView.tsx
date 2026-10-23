"use client";

import { useState } from "react";
import type { GoalRow } from "@/lib/agent/clientTypes";
import { EMPTY_GOAL, GOAL_STATUSES, useGoals, type GoalInput } from "./data/useGoals";

const STATUS_STYLE: Record<string, string> = {
  backlog: "text-neutral-400",
  in_progress: "text-blue-300",
  done: "text-emerald-400",
  abandoned: "text-rose-400",
};

export default function GoalsView() {
  const { goals, conversations, create, update, remove: removeGoal } = useGoals();
  const [form, setForm] = useState<GoalInput>(EMPTY_GOAL);
  const set = (patch: Partial<GoalInput>) => setForm((f) => ({ ...f, ...patch }));

  async function createGoal() {
    if (!form.title.trim()) return;
    await create(form);
    setForm((f) => ({ ...EMPTY_GOAL, priority: f.priority }));
  }

  async function remove(goal: GoalRow) {
    if (!confirm(`Delete the goal "${goal.title}"? This can't be undone.`)) return;
    await removeGoal(goal.id);
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
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Goal title, e.g. 'Build a local dashboard for my metrics'"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
            />
            <textarea
              value={form.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="Notes / details (optional)"
              rows={2}
              className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-400">
                Priority (1 = highest)
                <input
                  type="number"
                  value={form.priority}
                  min={1}
                  max={5}
                  onChange={(e) => set({ priority: Number(e.target.value) || 3 })}
                  className="ml-2 w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm outline-none"
                />
              </label>
              <label className="text-xs text-neutral-400">
                Session
                <select
                  value={form.conversationId}
                  onChange={(e) => set({ conversationId: e.target.value })}
                  className="ml-2 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm outline-none"
                >
                  <option value="">Global (work windows)</option>
                  {conversations.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      #{c.id} {c.title.slice(0, 30)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={createGoal}
                disabled={!form.title.trim()}
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
                  <select
                    value={g.conversationId ?? ""}
                    onChange={(e) =>
                      update(g.id, { conversationId: e.target.value ? Number(e.target.value) : null })
                    }
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[11px] text-neutral-400 outline-none"
                  >
                    <option value="">Global</option>
                    {conversations.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.id} {c.title.slice(0, 24)}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => remove(g)}
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
