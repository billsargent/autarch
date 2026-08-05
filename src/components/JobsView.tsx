"use client";

import { useCallback, useEffect, useState } from "react";
import type { JobRow, WorkSessionRow } from "@/lib/agent/clientTypes";

export default function JobsView() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(10);
  const [cron, setCron] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [runs, setRuns] = useState<Record<number, WorkSessionRow[]>>({});
  const [editing, setEditing] = useState<JobRow | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/jobs").then((r) => r.json());
    setJobs(res.jobs || []);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 8000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  async function saveJob() {
    if (!name.trim()) return;
    const payload = { name, instruction, intervalMinutes, maxDurationMinutes, cron: cron.trim() || undefined };
    if (editing) {
      await fetch(`/api/jobs/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    cancelEdit();
    await load();
  }

  function startEdit(job: JobRow) {
    setEditing(job);
    setName(job.name);
    setInstruction(job.instruction);
    setIntervalMinutes(job.intervalMinutes);
    setMaxDurationMinutes(job.maxDurationMinutes);
    setCron(job.cron || "");
  }

  function cancelEdit() {
    setEditing(null);
    setName("");
    setInstruction("");
    setIntervalMinutes(60);
    setMaxDurationMinutes(10);
    setCron("");
  }

  async function toggleRuns(jobId: number) {
    const next = expandedId === jobId ? null : jobId;
    setExpandedId(next);
    if (next !== null) {
      const res = await fetch(`/api/jobs/${jobId}/runs`).then((r) => r.json());
      setRuns((prev) => ({ ...prev, [jobId]: res.runs || [] }));
    }
  }

  async function setEnabled(job: JobRow, enabled: boolean) {
    await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await load();
  }

  async function remove(job: JobRow) {
    await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-semibold">Jobs</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Recurring work windows that the background worker opens for the agent. The agent can also create and manage
          these itself with its <code className="text-neutral-400">schedule_job</code> tools.
        </p>

        <section className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold">{editing ? `Edit job: ${editing.name}` : "Schedule a new job"}</h2>
          <div className="mt-3 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Job name, e.g. 'Daily system health check'"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
            />
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="What should the agent do during each window? (leave empty to let it decide)"
              rows={2}
              className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
            />
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-neutral-400">
                Every (minutes)
                <input
                  type="number"
                  value={intervalMinutes}
                  min={5}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value) || 60)}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
                />
              </label>
              <label className="flex-1 text-xs text-neutral-400">
                Max duration (minutes)
                <input
                  type="number"
                  value={maxDurationMinutes}
                  min={1}
                  onChange={(e) => setMaxDurationMinutes(Number(e.target.value) || 10)}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
                />
              </label>
            </div>
            <label className="block text-xs text-neutral-400">
              Cron (optional — overrides the interval; 5 fields: min hour dom month dow)
              <input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="e.g. 30 3 * * 1  → 03:30 every Monday"
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={saveJob}
                disabled={!name.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {editing ? "Save changes" : "Create job"}
              </button>
              {editing && (
                <button
                  onClick={cancelEdit}
                  className="rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="mt-5 space-y-3">
          {jobs.length === 0 && (
            <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-500">
              No jobs yet. Create one above — the agent will get a work window at each interval (subject to its
              cooldown and daily caps).
            </p>
          )}
          {jobs.map((j) => (
            <div key={j.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {j.name}
                    {j.kind === "daily_report" && (
                      <span className="ml-2 rounded-full border border-blue-700 bg-blue-950/40 px-2 py-0.5 text-[10px] font-bold text-blue-300">
                        daily report
                      </span>
                    )}
                    {j.kind === "self_work" && (
                      <span className="ml-2 rounded-full border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        self-work
                      </span>
                    )}
                  </p>
                  {j.instruction && <p className="mt-1 text-xs text-neutral-400">{j.instruction}</p>}
                  <p className="mt-2 text-[11px] text-neutral-500">
                    {j.cron ? `cron "${j.cron}"` : `every ${j.intervalMinutes} min`} · up to {j.maxDurationMinutes} min ·
                    next run {new Date(j.nextRunAt).toLocaleString()}
                  </p>
                  {j.lastStatus && (
                    <p className="mt-1 text-[11px]">
                      last run: <span className={j.lastStatus === "failed" ? "text-red-400" : "text-neutral-400"}>{j.lastStatus}</span>
                      {j.lastError && <span className="ml-2 text-red-400/80">({j.lastError})</span>}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => startEdit(j)}
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleRuns(j.id)}
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
                  >
                    {expandedId === j.id ? "Hide history" : "History"}
                  </button>
                  <button
                    onClick={() => setEnabled(j, !j.enabled)}
                    className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold ${
                      j.enabled
                        ? "border-emerald-700 bg-emerald-900/40 text-emerald-300"
                        : "border-neutral-700 bg-neutral-950 text-neutral-400"
                    }`}
                  >
                    {j.enabled ? "Enabled" : "Paused"}
                  </button>
                  <button
                    onClick={() => remove(j)}
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-[11px] text-red-400 hover:bg-red-950/30"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {expandedId === j.id && (
                <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-neutral-500">Past runs</p>
                  {!runs[j.id]?.length && <p className="text-[11px] text-neutral-600">No runs yet.</p>}
                  {runs[j.id]?.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 border-t border-neutral-800 py-1 text-[11px]"
                    >
                      <span className="text-neutral-400">
                        {new Date(r.startedAt).toLocaleString()}
                        {r.endedAt ? ` → ${new Date(r.endedAt).toLocaleTimeString()}` : ""}
                      </span>
                      <span
                        className={
                          r.status === "failed"
                            ? "text-red-400"
                            : r.status === "running"
                              ? "text-blue-400"
                              : "text-neutral-400"
                        }
                      >
                        {r.status}
                      </span>
                      <span className="text-neutral-500">
                        {r.stepsUsed} steps · {r.actionsUsed} acts · ${r.costUsd.toFixed(4)}
                      </span>
                      {r.reason && <span className="text-red-400/80">({r.reason})</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
