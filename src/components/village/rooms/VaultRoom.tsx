"use client";

import { useState } from "react";
import { USAGE_PERIODS, cacheHitRate, fmtCost, fmtTokens, usageCards, useUsage, type UsagePeriod } from "../../data/useUsage";
import ParchmentDialog from "../ParchmentDialog";
import type { RoomProps } from "./types";
import VillagerPortrait from "../VillagerPortrait";
import { useVillagers } from "../../data/useVillagers";

// The vault: the coffers hold the spending totals and the ledger breaks them
// down by period. Same data as the Usage page (useUsage).

const PERIOD_LABEL: Record<UsagePeriod, string> = { daily: "By day", weekly: "By week", monthly: "By month", yearly: "By year" };

export default function VaultRoom({ action, onClose }: RoomProps) {
  const { data } = useUsage();
  const { villagers } = useVillagers(15000);
  const [view, setView] = useState<"ledger" | "coffers">(action === "usage.totals" ? "coffers" : "ledger");
  const [period, setPeriod] = useState<UsagePeriod>("daily");
  const rows = data ? data[period] : [];
  const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0);

  const totals = (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {usageCards(data).map((c) => (
        <li key={c.label} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2">
          <p className="text-[11px] font-semibold text-[#6b4a2e]">{c.label}</p>
          <p className="village-pixel mt-0.5 text-base">{c.t ? fmtCost(c.t.cost) : "—"}</p>
          <p className="text-[11px] text-[#6b4a2e]">{c.t ? `${fmtTokens(c.t.total)} tokens · ${c.t.sessions} sessions` : ""}</p>
        </li>
      ))}
    </ul>
  );

  if (view === "coffers") {
    return (
      <ParchmentDialog
        kicker="The vault"
        title="The coffers"
        onClose={onClose}
        wide
        footer={
          <button onClick={() => setView("ledger")} className="village-btn ml-auto px-3 py-2 text-xs">
            📒 Open the ledger
          </button>
        }
      >
        <p className="mb-3 text-xs text-[#6b4a2e]">What the agents have spent on model calls. Skipped sessions aren&apos;t counted.</p>
        {data ? totals : <p className="text-sm">Counting the coins…</p>}
        <h3 className="village-pixel mb-1.5 mt-4 text-xs">Each villager today</h3>
        <ul className="space-y-1.5">
          {villagers.map((v) => {
            const share = v.dailyBudgetUsd ? Math.min(100, (v.spentToday / v.dailyBudgetUsd) * 100) : 0;
            return (
              <li key={v.id} className="flex items-center gap-2 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-xs">
                <VillagerPortrait character={v.character} color={v.color} size={20} />
                <span className="w-28 truncate font-semibold">{v.name}</span>
                <span className="w-32">
                  {fmtCost(v.spentToday)}
                  {v.dailyBudgetUsd != null ? ` of ${fmtCost(v.dailyBudgetUsd)}` : ""}
                </span>
                {v.dailyBudgetUsd != null ? (
                  <span className="h-2 flex-1 overflow-hidden rounded-sm border border-[#3b2716] bg-[#e8dcc2]">
                    <span className="block h-full" style={{ width: `${share}%`, background: share >= 100 ? "#b3261e" : share > 75 ? "#c58a1b" : "#5f8a3c" }} />
                  </span>
                ) : (
                  <span className="flex-1 text-[#6b4a2e]">no budget of their own</span>
                )}
              </li>
            );
          })}
        </ul>
      </ParchmentDialog>
    );
  }

  return (
    <ParchmentDialog
      kicker="The vault"
      title="Ledger"
      onClose={onClose}
      wide
      footer={
        <button onClick={() => setView("coffers")} className="village-btn ml-auto px-3 py-2 text-xs">
          💰 The coffers
        </button>
      }
    >
      <div role="tablist" aria-label="Period" className="mb-3 flex flex-wrap gap-1.5">
        {USAGE_PERIODS.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={`village-btn px-2.5 py-1 text-[11px] ${period === p ? "village-btn-go" : ""}`}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>
      {!data && <p className="text-sm">Opening the ledger…</p>}
      {data && (
        <div className="overflow-x-auto rounded border-2 border-[#3b2716] bg-[#fffaf0]">
          <table className="w-full text-left text-xs">
            <thead className="border-b-2 border-[#3b2716] bg-[#ead9b4]">
              <tr>
                <th className="px-2 py-1.5">Period</th>
                <th className="px-2 py-1.5 text-right">Prompt</th>
                <th className="px-2 py-1.5 text-right">Completion</th>
                <th className="px-2 py-1.5 text-right">Total</th>
                <th className="px-2 py-1.5 text-right">Cost</th>
                <th className="px-2 py-1.5 text-right">Cache hit</th>
                <th className="px-2 py-1.5 text-right">Sessions</th>
                <th className="w-24 px-2 py-1.5">
                  <span className="sr-only">Share</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e6d6b0]">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-[#6b4a2e]">
                    Nothing written in the ledger yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.bucket}>
                  <td className="px-2 py-1.5 font-mono">{r.bucket}</td>
                  <td className="px-2 py-1.5 text-right">{fmtTokens(r.prompt)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtTokens(r.completion)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{fmtTokens(r.total)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtCost(r.cost)}</td>
                  <td className="px-2 py-1.5 text-right">{cacheHitRate(r)}</td>
                  <td className="px-2 py-1.5 text-right">{r.sessions}</td>
                  <td className="px-2 py-1.5">
                    <div className="h-2.5 overflow-hidden rounded-sm border border-[#3b2716] bg-[#e8dcc2]">
                      <div
                        className="h-full bg-[#e3b04b]"
                        style={{ width: `${maxTotal > 0 ? Math.max(2, Math.round((r.total / maxTotal) * 100)) : 0}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ParchmentDialog>
  );
}
