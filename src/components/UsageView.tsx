"use client";

import { useState } from "react";
import { USAGE_PERIODS, cacheHitRate, fmtCost, fmtTokens as fmt, usageCards, useUsage, type UsagePeriod } from "./data/useUsage";

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
      <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export default function UsageView() {
  const { data } = useUsage();
  const [period, setPeriod] = useState<UsagePeriod>("daily");

  const rows = data ? data[period] : [];
  const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const cards = usageCards(data);

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Usage</h1>
            <p className="mt-1 text-sm text-neutral-500">Token and cost tracking across work sessions.</p>
          </div>
          <div className="flex rounded-lg border border-neutral-700 bg-neutral-950 p-0.5 text-[11px]">
            {USAGE_PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1 capitalize ${
                  period === p ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <p className="text-[11px] uppercase tracking-wide text-neutral-500">{c.label}</p>
              <p className="mt-1 text-lg font-semibold text-neutral-100">{c.t ? fmt(c.t.total) : "—"}</p>
              <p className="text-[11px] text-neutral-400">tokens{c.t ? ` · ${fmtCost(c.t.cost)}` : ""}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-neutral-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 text-right font-medium">Prompt</th>
                <th className="px-3 py-2 text-right font-medium">Completion</th>
                <th className="px-3 py-2 text-right font-medium">Total tokens</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Cache hit</th>
                <th className="px-3 py-2 text-right font-medium">Sessions</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 bg-neutral-950">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-neutral-500">
                    No usage recorded yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.bucket} className="text-neutral-300">
                  <td className="px-3 py-2 font-mono">{r.bucket}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.prompt)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.completion)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-neutral-100">{fmt(r.total)}</td>
                  <td className="px-3 py-2 text-right">{fmtCost(r.cost)}</td>
                  <td className="px-3 py-2 text-right">
                    {cacheHitRate(r)}
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(r.sessions)}</td>
                  <td className="w-28 px-3 py-2">
                    <Bar value={r.total} max={maxTotal} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[10px] text-neutral-600">
          Auto-refreshes every 30s. Excludes skipped sessions. Refresh is manual-only below if you close this tab.
        </p>
      </div>
    </div>
  );
}
