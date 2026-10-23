"use client";

import { useState } from "react";
import type { GoalRow } from "@/lib/agent/clientTypes";
import { EMPTY_GOAL, GOAL_STATUSES, GOAL_STATUS_LABEL, useGoals, type GoalInput } from "../../data/useGoals";
import ParchmentDialog, { ConfirmDialog } from "../ParchmentDialog";
import type { RoomProps } from "./types";

// The notice board in the village square: goals are notes pinned to it.
// Same data and actions as the Goals page (useGoals). Ideas and votes join
// the board with #98.

type View = { kind: "board" } | { kind: "note"; id: number } | { kind: "pin" };

const field = "mt-1 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm font-normal outline-none";

// Pin colors by priority: 1 is the most urgent.
const PIN: Record<number, string> = { 1: "#b3261e", 2: "#d9643a", 3: "#e3b04b", 4: "#5f8a3c", 5: "#4f86c6" };
const pinColor = (p: number) => PIN[Math.min(5, Math.max(1, p))];

const SECTIONS: Array<{ title: string; statuses: GoalRow["status"][]; empty: string }> = [
  { title: "Being worked on", statuses: ["in_progress"], empty: "Nothing in progress." },
  { title: "Up next", statuses: ["backlog"], empty: "No goals waiting." },
  { title: "Taken down", statuses: ["done", "abandoned"], empty: "" },
];

export default function NoticeBoardRoom({ action, onClose }: RoomProps) {
  const { goals, conversations, loaded, create, update, remove } = useGoals();
  const [view, setView] = useState<View>(() => (action === "goals.new" ? { kind: "pin" } : { kind: "board" }));
  const [showOld, setShowOld] = useState(false);
  const toBoard = () => setView({ kind: "board" });

  if (view.kind === "pin") {
    return (
      <GoalEditor
        conversations={conversations}
        onSave={async (input) => {
          await create(input);
          toBoard();
        }}
        onBack={toBoard}
        onClose={onClose}
      />
    );
  }

  if (view.kind === "note") {
    const goal = goals.find((g) => g.id === view.id);
    if (!goal) {
      return (
        <ParchmentDialog kicker="The notice board" title="Note not found" onClose={onClose}>
          <p className="text-sm">{loaded ? "This goal isn't on the board any more." : "Reading the board…"}</p>
          <button onClick={toBoard} className="village-btn mt-3 px-3 py-2 text-xs">
            Back to the board
          </button>
        </ParchmentDialog>
      );
    }
    return (
      <GoalEditor
        key={goal.id}
        goal={goal}
        conversations={conversations}
        onSave={(input) =>
          update(goal.id, {
            title: input.title,
            body: input.body || null,
            priority: input.priority,
            conversationId: input.conversationId ? Number(input.conversationId) : null,
          })
        }
        onStatus={(status) => update(goal.id, { status })}
        onDelete={async () => {
          await remove(goal.id);
          toBoard();
        }}
        onBack={toBoard}
        onClose={onClose}
      />
    );
  }

  const open = goals.filter((g) => g.status === "in_progress" || g.status === "backlog");
  return (
    <ParchmentDialog
      kicker="The village square"
      title="Notice board"
      onClose={onClose}
      wide
      footer={
        <button onClick={() => setView({ kind: "pin" })} className="village-btn village-btn-primary px-3 py-2 text-xs">
          📌 Pin a new goal
        </button>
      }
    >
      <p className="mb-3 text-xs text-[#6b4a2e]">
        Goals the agent works toward. It reads the board at the start of every work window and picks what to do from it,
        most urgent pin first. It can pin and update its own notes with its <code>manage_goal</code> tools.
      </p>
      {!loaded && <p className="text-sm">Reading the board…</p>}
      {loaded && goals.length === 0 && (
        <p className="rounded border-2 border-dashed border-[#c9b27a] p-4 text-center text-sm">
          Nothing pinned yet. Pin a goal, or ask the agent to propose some.
        </p>
      )}
      {loaded && goals.length > 0 && open.length === 0 && <p className="mb-2 text-sm">Every goal is done or taken down. Pin a new one?</p>}
      {SECTIONS.map((sec) => {
        const list = goals.filter((g) => sec.statuses.includes(g.status));
        const old = sec.statuses.includes("done");
        if (!loaded || (old && list.length === 0) || goals.length === 0) return null;
        return (
          <section key={sec.title} className="mb-3">
            <h3 className="village-pixel mb-1.5 flex items-center gap-2 text-xs">
              {sec.title} <span className="text-[#6b4a2e]">({list.length})</span>
              {old && (
                <button onClick={() => setShowOld((v) => !v)} className="ml-auto text-[11px] font-normal underline">
                  {showOld ? "Hide" : "Show"}
                </button>
              )}
            </h3>
            {list.length === 0 && <p className="text-xs text-[#6b4a2e]">{sec.empty}</p>}
            {(!old || showOld) && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {list.map((g) => (
                  <li key={g.id}>
                    <button
                      onClick={() => setView({ kind: "note", id: g.id })}
                      className={`relative flex w-full items-start gap-2 rounded-sm border-2 border-[#3b2716] px-3 pb-2 pt-3 text-left shadow-[2px_3px_0_rgba(59,39,22,0.35)] hover:bg-white focus-visible:outline-4 focus-visible:outline-[#e3b04b] ${
                        old ? "bg-[#ece2cb] opacity-80" : "bg-[#fffaf0]"
                      }`}
                    >
                      <span
                        aria-hidden
                        className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-[#3b2716]"
                        style={{ background: pinColor(g.priority) }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={`village-pixel block text-sm ${g.status === "abandoned" ? "line-through" : ""}`}>{g.title}</span>
                        {g.body && <span className="mt-0.5 line-clamp-2 block text-[11px] text-[#6b4a2e]">{g.body}</span>}
                        <span className="mt-1 block text-[11px] text-[#6b4a2e]">
                          Priority {g.priority}
                          {old && ` · ${GOAL_STATUS_LABEL[g.status].toLowerCase()}`}
                          {g.conversationId ? ` · conversation #${g.conversationId}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </ParchmentDialog>
  );
}

function GoalEditor({
  goal,
  conversations,
  onSave,
  onStatus,
  onDelete,
  onBack,
  onClose,
}: {
  goal?: GoalRow;
  conversations: { id: number; title: string }[];
  onSave: (input: GoalInput) => Promise<void>;
  onStatus?: (status: GoalRow["status"]) => Promise<void>;
  onDelete?: () => Promise<void>;
  onBack: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<GoalInput>(
    goal
      ? { title: goal.title, body: goal.body ?? "", priority: goal.priority, conversationId: goal.conversationId ? String(goal.conversationId) : "" }
      : EMPTY_GOAL,
  );
  const set = (patch: Partial<GoalInput>) => setForm((f) => ({ ...f, ...patch }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function submit() {
    setSaving(true);
    setSaved(false);
    await onSave(form);
    setSaving(false);
    setSaved(true);
  }

  if (confirmDelete && goal && onDelete) {
    return (
      <ConfirmDialog
        title="Take this note down for good?"
        message={
          <>
            Delete the goal <strong>{goal.title}</strong>? To keep it on record, mark it done or abandoned instead. This
            can&apos;t be undone.
          </>
        }
        confirmLabel="Delete goal"
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    );
  }

  return (
    <ParchmentDialog
      kicker="The notice board"
      title={goal ? goal.title : "Pin a new goal"}
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={() => void submit()} disabled={saving || !form.title.trim()} className="village-btn village-btn-primary px-4 py-2 text-xs">
            {saving ? "Saving…" : goal ? "Save changes" : "Pin it up"}
          </button>
          {goal && onDelete && (
            <button onClick={() => setConfirmDelete(true)} className="village-btn village-btn-danger px-3 py-2 text-xs">
              Delete
            </button>
          )}
          <button onClick={onBack} className="village-btn ml-auto px-3 py-2 text-xs">
            ← Board
          </button>
        </>
      }
    >
      {goal && onStatus && (
        <fieldset className="mb-3">
          <legend className="text-xs font-semibold">Status</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {GOAL_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => void onStatus(s)}
                aria-pressed={goal.status === s}
                className={`village-btn px-2.5 py-1 text-[11px] ${goal.status === s ? "village-btn-go" : ""}`}
              >
                {GOAL_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <label className="block text-xs font-semibold">
        Goal
        <input
          name="title"
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          data-autofocus={goal ? undefined : true}
          placeholder="e.g. Build a local dashboard for my metrics"
          className={field}
        />
      </label>
      <label className="mt-3 block text-xs font-semibold">
        Notes
        <textarea
          name="body"
          value={form.body}
          onChange={(e) => set({ body: e.target.value })}
          rows={4}
          placeholder="Details, links, what done looks like (optional)"
          className={`${field} resize-y`}
        />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">
          Priority (1 = most urgent)
          <select name="priority" value={form.priority} onChange={(e) => set({ priority: Number(e.target.value) })} className={field}>
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold">
          Belongs to
          <select name="conversationId" value={form.conversationId} onChange={(e) => set({ conversationId: e.target.value })} className={field}>
            <option value="">Everything (work windows)</option>
            {conversations.map((c) => (
              <option key={c.id} value={String(c.id)}>
                #{c.id} {c.title.slice(0, 30)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {saved && <p className="mt-3 text-xs text-[#3f6b22]">Saved.</p>}
    </ParchmentDialog>
  );
}
