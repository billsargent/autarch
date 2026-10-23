"use client";

import { useEffect, useState } from "react";
import type { JobRow, WorkSessionRow } from "@/lib/agent/clientTypes";
import { EMPTY_JOB, jobInput, jobSchedule, useJobs, type JobInput, type JobResult } from "../../data/useJobs";
import ParchmentDialog, { ConfirmDialog } from "../ParchmentDialog";
import VillagerPortrait from "../VillagerPortrait";
import { useVillagers } from "../../data/useVillagers";
import type { AgentRow } from "@/lib/agent/clientTypes";
import type { RoomProps } from "./types";

// The workshop: each job is a slip on the job board; new jobs are set up at
// the workbench. Same data and actions as the Jobs page (useJobs).

type View =
  | { kind: "board" }
  | { kind: "slip"; id: number; note?: string }
  | { kind: "bench"; id?: number }
  | { kind: "history"; id: number };

const field = "mt-1 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm font-normal outline-none";
const KIND_BADGE: Record<JobRow["kind"], string | null> = { interval: null, daily_report: "daily report", self_work: "self-work" };

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusColor(status: string | null): string {
  return status === "failed" ? "text-[#b3261e]" : status === "running" ? "text-[#2f6aa8]" : "text-[#6b4a2e]";
}

export default function WorkshopRoom({ action, onClose }: RoomProps) {
  const jobsApi = useJobs();
  const { villagers, byId } = useVillagers(15000);
  const { jobs, loaded } = jobsApi;
  const [view, setView] = useState<View>(() => (action === "jobs.new" ? { kind: "bench" } : { kind: "board" }));
  const toBoard = () => setView({ kind: "board" });

  if (view.kind === "bench") {
    const job = view.id ? jobs.find((j) => j.id === view.id) : undefined;
    if (view.id && !job) return <Missing loaded={loaded} onBack={toBoard} onClose={onClose} />;
    return (
      <JobEditor
        key={view.id ?? "new"}
        job={job}
        conversations={jobsApi.conversations}
        villagers={villagers}
        onSave={async (input) => {
          const res = await jobsApi.save(input, job?.id);
          if (res.ok && job) setView({ kind: "slip", id: job.id, note: "Saved." });
          else if (res.ok) toBoard();
          return res;
        }}
        onBack={() => (job ? setView({ kind: "slip", id: job.id }) : toBoard())}
        onClose={onClose}
      />
    );
  }

  if (view.kind === "slip" || view.kind === "history") {
    const job = jobs.find((j) => j.id === view.id);
    if (!job) return <Missing loaded={loaded} onBack={toBoard} onClose={onClose} />;
    if (view.kind === "history") {
      return <History job={job} loadRuns={jobsApi.loadRuns} onBack={() => setView({ kind: "slip", id: job.id })} onClose={onClose} />;
    }
    return (
      <Slip
        key={job.id}
        job={job}
        note={view.note}
        conversations={jobsApi.conversations}
        owner={byId(job.agentId)}
        onRunNow={() => jobsApi.runNow(job)}
        onToggle={() => jobsApi.setEnabled(job, !job.enabled)}
        onEdit={() => setView({ kind: "bench", id: job.id })}
        onHistory={() => setView({ kind: "history", id: job.id })}
        onDelete={async () => {
          await jobsApi.remove(job);
          toBoard();
        }}
        onBack={toBoard}
        onClose={onClose}
      />
    );
  }

  return (
    <ParchmentDialog
      kicker="The workshop"
      title="Job board"
      onClose={onClose}
      wide
      footer={
        <button onClick={() => setView({ kind: "bench" })} className="village-btn village-btn-primary px-3 py-2 text-xs">
          🔨 Set up a new job
        </button>
      }
    >
      <p className="mb-3 text-xs text-[#6b4a2e]">
        Each slip is a recurring work window the worker opens for the agent: on a timer or a cron schedule, for up to a set
        number of minutes. The agent can pin its own slips with its <code>schedule_job</code> tools.
      </p>
      {!loaded && <p className="text-sm">Reading the slips…</p>}
      {loaded && jobs.length === 0 && (
        <p className="rounded border-2 border-dashed border-[#c9b27a] p-4 text-center text-sm">
          The board is empty. Set up the first job at the workbench.
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {jobs.map((j) => (
          <li key={j.id}>
            <button
              onClick={() => setView({ kind: "slip", id: j.id })}
              className={`flex w-full items-start gap-3 rounded border-2 border-[#3b2716] px-3 py-2 text-left hover:bg-white focus-visible:outline-4 focus-visible:outline-[#e3b04b] ${
                j.enabled ? "bg-[#fffaf0]" : "bg-[#e8dcc2] opacity-80"
              }`}
            >
              <span aria-hidden className="mt-0.5 text-lg">
                {j.enabled ? "📌" : "📎"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="village-pixel block truncate text-sm">{j.name}</span>
                <span className="block text-[11px] text-[#6b4a2e]">
                  {j.enabled ? `${jobSchedule(j)} · next ${when(j.nextRunAt)}` : "Paused — taken down from the schedule"}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                  {byId(j.agentId) && (
                    <span className="flex items-center gap-1 text-[#6b4a2e]">
                      <VillagerPortrait character={byId(j.agentId)!.character} color={byId(j.agentId)!.color} size={14} />
                      {byId(j.agentId)!.name}
                    </span>
                  )}
                  {KIND_BADGE[j.kind] && <span className="rounded bg-[#dbe7f3] px-1.5 text-[#2f4f7a]">{KIND_BADGE[j.kind]}</span>}
                  {j.lastStatus && <span className={statusColor(j.lastStatus)}>last run: {j.lastStatus}</span>}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ParchmentDialog>
  );
}

function Missing({ loaded, onBack, onClose }: { loaded: boolean; onBack: () => void; onClose: () => void }) {
  return (
    <ParchmentDialog kicker="The workshop" title="Slip not found" onClose={onClose}>
      <p className="text-sm">{loaded ? "This job isn't on the board any more." : "Reading the slips…"}</p>
      <button onClick={onBack} className="village-btn mt-3 px-3 py-2 text-xs">
        Back to the board
      </button>
    </ParchmentDialog>
  );
}

function Slip({
  job,
  note,
  conversations,
  owner,
  onRunNow,
  onToggle,
  onEdit,
  onHistory,
  onDelete,
  onBack,
  onClose,
}: {
  job: JobRow;
  note?: string;
  conversations: { id: number; title: string }[];
  owner: AgentRow | null;
  onRunNow: () => Promise<JobResult>;
  onToggle: () => Promise<void>;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => Promise<void>;
  onBack: () => void;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(note ? { text: note, ok: true } : null);
  const [busy, setBusy] = useState<"run" | "toggle" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const report = conversations.find((c) => c.id === job.conversationId);

  async function run() {
    setBusy("run");
    setMsg(null);
    const res = await onRunNow();
    setMsg(res.ok ? { text: "Started — the agent is on it.", ok: true } : { text: res.error, ok: false });
    setBusy(null);
  }

  async function toggle() {
    setBusy("toggle");
    setMsg(null);
    await onToggle();
    setBusy(null);
  }

  if (confirmDelete) {
    return (
      <ConfirmDialog
        title="Tear down this slip?"
        message={
          <>
            Delete the job <strong>{job.name}</strong>? It won&apos;t run again. Its past runs stay in the activity log. This
            can&apos;t be undone.
          </>
        }
        confirmLabel="Delete job"
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    );
  }

  return (
    <ParchmentDialog
      kicker="The job board"
      title={job.name}
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={() => void run()} disabled={busy !== null} className="village-btn village-btn-go px-3 py-2 text-xs">
            {busy === "run" ? "Starting…" : "▶ Run now"}
          </button>
          <button onClick={() => void toggle()} disabled={busy !== null} className="village-btn px-3 py-2 text-xs">
            {job.enabled ? "⏸ Pause" : "▶ Resume"}
          </button>
          <button onClick={onEdit} className="village-btn px-3 py-2 text-xs">
            ✎ Edit
          </button>
          <button onClick={onHistory} className="village-btn px-3 py-2 text-xs">
            History
          </button>
          <button onClick={() => setConfirmDelete(true)} className="village-btn village-btn-danger px-3 py-2 text-xs">
            Delete
          </button>
          <button onClick={onBack} className="village-btn ml-auto px-3 py-2 text-xs">
            ← Board
          </button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-xs font-semibold text-[#6b4a2e]">Done by</dt>
        <dd className="flex items-center gap-1.5">
          {owner ? (
            <>
              <VillagerPortrait character={owner.character} color={owner.color} size={16} />
              {owner.name}
            </>
          ) : (
            "—"
          )}
        </dd>
        <dt className="text-xs font-semibold text-[#6b4a2e]">Status</dt>
        <dd>
          {job.enabled ? "On the schedule" : "Paused"}
          {KIND_BADGE[job.kind] && <span className="ml-2 rounded bg-[#dbe7f3] px-1.5 text-[11px] text-[#2f4f7a]">{KIND_BADGE[job.kind]}</span>}
        </dd>
        <dt className="text-xs font-semibold text-[#6b4a2e]">Schedule</dt>
        <dd>
          {jobSchedule(job)} · up to {job.maxDurationMinutes} min
        </dd>
        {job.enabled && (
          <>
            <dt className="text-xs font-semibold text-[#6b4a2e]">Next run</dt>
            <dd>{when(job.nextRunAt)}</dd>
          </>
        )}
        <dt className="text-xs font-semibold text-[#6b4a2e]">Last run</dt>
        <dd>
          {job.lastStatus ? (
            <>
              <span className={statusColor(job.lastStatus)}>{job.lastStatus}</span>
              {job.lastRunAt && <span className="text-[#6b4a2e]"> · {when(job.lastRunAt)}</span>}
              {job.lastError && <span className="block text-xs text-[#b3261e]">{job.lastError}</span>}
            </>
          ) : (
            "Never run yet"
          )}
        </dd>
        <dt className="text-xs font-semibold text-[#6b4a2e]">Reports to</dt>
        <dd>
          {job.conversationId
            ? `#${job.conversationId}${report ? ` ${report.title}` : ""}`
            : `a new conversation${job.reportSessionTitle ? ` called "${job.reportSessionTitle}"` : ""}`}
        </dd>
      </dl>
      <h3 className="village-pixel mt-4 text-xs">Instructions</h3>
      <p className="mt-1 whitespace-pre-wrap rounded border-2 border-[#d8c49a] bg-[#fffaf0] px-3 py-2 text-sm">
        {job.instruction || <span className="text-[#6b4a2e]">None — the agent decides what to do.</span>}
      </p>
      {msg && <p className={`mt-3 text-xs ${msg.ok ? "text-[#3f6b22]" : "text-[#b3261e]"}`}>{msg.text}</p>}
    </ParchmentDialog>
  );
}

function History({
  job,
  loadRuns,
  onBack,
  onClose,
}: {
  job: JobRow;
  loadRuns: (id: number) => Promise<WorkSessionRow[]>;
  onBack: () => void;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<WorkSessionRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadRuns(job.id).then((r) => alive && setRuns(r));
    return () => {
      alive = false;
    };
  }, [job.id, loadRuns]);

  return (
    <ParchmentDialog
      kicker={job.name}
      title="Past runs"
      onClose={onClose}
      wide
      footer={
        <button onClick={onBack} className="village-btn ml-auto px-3 py-2 text-xs">
          ← Back to the slip
        </button>
      }
    >
      {!runs && <p className="text-sm">Leafing through the logbook…</p>}
      {runs?.length === 0 && <p className="text-sm">No runs yet.</p>}
      {runs && runs.length > 0 && (
        <ul className="divide-y-2 divide-[#e6d6b0] text-xs">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 py-1.5">
              <span className="min-w-40">
                {new Date(r.startedAt).toLocaleString()}
                {r.endedAt ? ` → ${new Date(r.endedAt).toLocaleTimeString()}` : ""}
              </span>
              <span className={`font-semibold ${statusColor(r.status)}`}>{r.status}</span>
              <span className="text-[#6b4a2e]">
                {r.stepsUsed} steps · {r.actionsUsed} actions · ${r.costUsd.toFixed(4)}
              </span>
              {r.reason && <span className="basis-full text-[#b3261e]">{r.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </ParchmentDialog>
  );
}

function JobEditor({
  job,
  conversations,
  villagers,
  onSave,
  onBack,
  onClose,
}: {
  job?: JobRow;
  conversations: { id: number; title: string }[];
  villagers: AgentRow[];
  onSave: (input: JobInput) => Promise<JobResult>;
  onBack: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<JobInput>(job ? jobInput(job) : EMPTY_JOB);
  const set = (patch: Partial<JobInput>) => setForm((f) => ({ ...f, ...patch }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await onSave(form);
    if (!res.ok) setError(res.error);
    setSaving(false);
  }

  return (
    <ParchmentDialog
      kicker="The workbench"
      title={job ? `Rework: ${job.name}` : "Set up a new job"}
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={() => void submit()} disabled={saving || !form.name.trim()} className="village-btn village-btn-primary px-4 py-2 text-xs">
            {saving ? "Saving…" : job ? "Save changes" : "Pin it to the board"}
          </button>
          <button onClick={onBack} className="village-btn ml-auto px-3 py-2 text-xs">
            {job ? "Cancel" : "← Board"}
          </button>
        </>
      }
    >
      <label className="block text-xs font-semibold">
        Name
        <input
          name="name"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          data-autofocus
          placeholder="e.g. Daily system health check"
          className={field}
        />
      </label>
      <label className="mt-3 block text-xs font-semibold">
        Who does it
        <select name="agentId" value={form.agentId} onChange={(e) => set({ agentId: e.target.value })} className={field}>
          {!form.agentId && <option value="">The Mayor</option>}
          {villagers.map((v) => (
            <option key={v.id} value={String(v.id)}>
              {v.name} ({v.role})
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-xs font-semibold">
        What should they do each time?
        <textarea
          name="instruction"
          value={form.instruction}
          onChange={(e) => set({ instruction: e.target.value })}
          rows={3}
          placeholder="Leave empty to let it decide"
          className={`${field} resize-y`}
        />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">
          Every (minutes)
          <input
            name="intervalMinutes"
            type="number"
            min={5}
            value={form.intervalMinutes}
            onChange={(e) => set({ intervalMinutes: Number(e.target.value) || 60 })}
            className={field}
          />
        </label>
        <label className="block text-xs font-semibold">
          Work for up to (minutes)
          <input
            name="maxDurationMinutes"
            type="number"
            min={1}
            value={form.maxDurationMinutes}
            onChange={(e) => set({ maxDurationMinutes: Number(e.target.value) || 10 })}
            className={field}
          />
        </label>
      </div>
      <label className="mt-3 block text-xs font-semibold">
        Cron schedule (optional — replaces &quot;every&quot;)
        <input
          name="cron"
          value={form.cron}
          onChange={(e) => set({ cron: e.target.value })}
          placeholder="e.g. 30 3 * * 1  → 03:30 every Monday"
          className={`${field} font-mono`}
        />
        <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">Five fields: minute, hour, day of month, month, day of week.</span>
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">
          Report to
          <select name="conversationId" value={form.conversationId} onChange={(e) => set({ conversationId: e.target.value })} className={field}>
            <option value="">A new conversation</option>
            {conversations.map((c) => (
              <option key={c.id} value={String(c.id)}>
                #{c.id} {c.title.slice(0, 36)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold">
          New conversation&apos;s title
          <input
            name="reportSessionTitle"
            value={form.reportSessionTitle}
            onChange={(e) => set({ reportSessionTitle: e.target.value })}
            disabled={Boolean(form.conversationId)}
            placeholder="Optional"
            className={`${field} disabled:opacity-50`}
          />
        </label>
      </div>
      {error && <p className="mt-3 text-xs text-[#b3261e]">{error}</p>}
    </ParchmentDialog>
  );
}
