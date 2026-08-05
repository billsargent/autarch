"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { ToolExecutionRow } from "@/lib/agent/clientTypes";
import { RISK_COLORS, STATUS_COLORS } from "@/lib/agent/clientTypes";

interface StatsData {
  today: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    actionsUsed: number;
    stepsUsed: number;
  };
  todaySessionCount: number;
}

export default function ActivityView() {
  const [rows, setRows] = useState<ToolExecutionRow[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);

  const load = useCallback(async () => {
    const [actRes, statsRes] = await Promise.all([
      fetch("/api/activity?limit=150").then((r) => r.json()),
      fetch("/api/stats").then((r) => r.json()),
    ]);
    setRows(actRes.executions || []);
    setStats(statsRes);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 6000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const filtered = rows.filter((r) => (filter === "all" ? true : r.status === filter));

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Activity log</h1>
            <p className="mt-1 text-sm text-neutral-500">Full audit trail of every tool call the agent has ever attempted.</p>
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs"
          >
            {["all", "success", "error", "awaiting_approval", "approved", "denied", "blocked", "rate_limited"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {stats && (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Sessions today" value={String(stats.todaySessionCount)} />
            <Stat label="Tool actions today" value={String(stats.today.actionsUsed)} />
            <Stat label="Model steps today" value={String(stats.today.stepsUsed)} />
            <Stat label="Tokens today" value={stats.today.totalTokens.toLocaleString()} />
            <Stat label="Cost today" value={`$${stats.today.costUsd.toFixed(4)}`} />
            <Stat
              label="Prompt / completion"
              value={`${stats.today.promptTokens.toLocaleString()} / ${stats.today.completionTokens.toLocaleString()}`}
            />
          </div>
        )}

        <div className="mt-5 overflow-hidden rounded-xl border border-neutral-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-900 text-neutral-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Tool</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Resolved by</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    className="cursor-pointer border-t border-neutral-800 hover:bg-neutral-900/60"
                  >
                    <td className="px-3 py-2 text-neutral-500">{new Date(r.requestedAt).toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono">{r.tool}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase ${RISK_COLORS[r.riskLevel]}`}>
                        {r.riskLevel}
                      </span>
                    </td>
                    <td className={`px-3 py-2 font-medium ${STATUS_COLORS[r.status]}`}>{r.status}</td>
                    <td className="px-3 py-2 text-neutral-500">{r.resolvedBy || "—"}</td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="border-t border-neutral-800 bg-neutral-950">
                      <td colSpan={5} className="px-3 py-3">
                        <p className="mb-1 text-neutral-500">input:</p>
                        <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-2 font-mono text-[11px]">
                          {JSON.stringify(r.input, null, 2)}
                        </pre>
                        <p className="mb-1 text-neutral-500">reason: {r.riskReason}</p>
                        <p className="mb-1 text-neutral-500">output:</p>
                        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-2 font-mono text-[11px]">
                          {r.output || "(none)"}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-4 text-center text-sm text-neutral-500">No activity yet.</p>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-neutral-100">{value}</p>
    </div>
  );
}
