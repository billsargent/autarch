"use client";

import { useState } from "react";
import { ACTIVITY_FILTERS, filterActivity, useActivity, type ActivityFilter, type TodayStats } from "../../data/useActivity";
import ParchmentDialog from "../ParchmentDialog";
import { RISK_WORDS, STATUS_WORDS } from "../tones";
import type { RoomProps } from "./types";
import { useVillagers } from "../../data/useVillagers";

// The guard tower: the logbook is the activity log (every tool call the agent
// has attempted) and the tally board shows today's numbers. Same data as the
// Activity page (useActivity).

const FILTER_LABEL: Record<ActivityFilter, string> = {
  all: "Everything",
  success: "Done",
  error: "Failed",
  awaiting_approval: "Waiting on you",
  approved: "Approved",
  denied: "Denied",
  blocked: "Blocked",
  rate_limited: "Rate-limited",
  cancelled: "Cancelled",
};

export default function GuardTowerRoom({ action, onClose }: RoomProps) {
  const { rows, stats, loaded } = useActivity();
  const { byId } = useVillagers(15000);
  const [view, setView] = useState<"log" | "tally">(action === "activity.today" ? "tally" : "log");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [open, setOpen] = useState<number | null>(null);
  const shown = filterActivity(rows, filter);

  if (view === "tally") {
    return (
      <ParchmentDialog
        kicker="The guard tower"
        title="Today's tally"
        onClose={onClose}
        footer={
          <button onClick={() => setView("log")} className="village-btn ml-auto px-3 py-2 text-xs">
            📖 Open the logbook
          </button>
        }
      >
        {stats ? <Tally stats={stats} /> : <p className="text-sm">Counting…</p>}
      </ParchmentDialog>
    );
  }

  return (
    <ParchmentDialog
      kicker="The guard tower"
      title="Logbook"
      onClose={onClose}
      wide
      footer={
        <>
          <label className="flex items-center gap-2 text-xs font-semibold">
            Show
            <select
              name="filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value as ActivityFilter)}
              className="rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 text-xs font-normal outline-none"
            >
              {ACTIVITY_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {FILTER_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => setView("tally")} className="village-btn ml-auto px-3 py-2 text-xs">
            Today&apos;s tally
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-[#6b4a2e]">
        The watch writes down every tool call the agent tries — what it was, how risky, and what happened. Open an entry
        for the exact input and output. Newest first; the last 150.
      </p>
      {!loaded && <p className="text-sm">Opening the logbook…</p>}
      {loaded && shown.length === 0 && (
        <p className="rounded border-2 border-dashed border-[#c9b27a] p-4 text-center text-sm">
          {rows.length === 0 ? "Nothing logged yet." : "No entries match this filter."}
        </p>
      )}
      <ul className="divide-y-2 divide-[#e6d6b0] rounded border-2 border-[#3b2716] bg-[#fffaf0]">
        {shown.map((r) => {
          const risk = RISK_WORDS[r.riskLevel] ?? RISK_WORDS.critical;
          const status = STATUS_WORDS[r.status] ?? { label: r.status, tone: "#6b4a2e" };
          const expanded = open === r.id;
          return (
            <li key={r.id}>
              <button
                onClick={() => setOpen(expanded ? null : r.id)}
                aria-expanded={expanded}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-left text-xs hover:bg-white sm:grid-cols-[9rem_1fr_5rem_7rem]"
              >
                <span className="text-[#6b4a2e] sm:order-none">{new Date(r.requestedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                <span className="col-span-2 truncate font-mono font-semibold sm:col-span-1">{r.tool}</span>
                <span className="font-semibold uppercase" style={{ color: risk.tone }}>
                  {risk.short}
                </span>
                <span className="text-right font-semibold" style={{ color: status.tone }}>
                  {status.label}
                </span>
              </button>
              {expanded && (
                <div className="space-y-2 border-t-2 border-dashed border-[#e6d6b0] px-3 py-2 text-xs">
                  {r.riskReason && <p className="text-[#6b4a2e]">{r.riskReason}</p>}
                  <p className="text-[#6b4a2e]">
                    {byId(r.agentId) ? `${byId(r.agentId)!.name}'s call · ` : ""}
                    {r.resolvedBy ? `Decided by ${r.resolvedBy}` : "No decision needed"}
                    {r.durationMs != null && ` · took ${(r.durationMs / 1000).toFixed(1)} s`}
                    {r.conversationId != null && ` · conversation #${r.conversationId}`}
                  </p>
                  <p className="font-semibold">Input</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border-2 border-[#3b2716] bg-[#1d1a16] p-2 font-mono text-[11px] text-[#f4ead5]">
                    {JSON.stringify(r.input, null, 2)}
                  </pre>
                  <p className="font-semibold">Output</p>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded border-2 border-[#3b2716] bg-[#1d1a16] p-2 font-mono text-[11px] text-[#f4ead5]">
                    {r.output || "(none)"}
                  </pre>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </ParchmentDialog>
  );
}

function Tally({ stats }: { stats: TodayStats }) {
  const t = stats.today;
  const items: Array<[string, string]> = [
    ["Work sessions", String(stats.todaySessionCount)],
    ["Tool actions", String(t.actionsUsed)],
    ["Model steps", String(t.stepsUsed)],
    ["Tokens", t.totalTokens.toLocaleString()],
    ["Prompt / completion", `${t.promptTokens.toLocaleString()} / ${t.completionTokens.toLocaleString()}`],
    ["Cost", `$${t.costUsd.toFixed(4)}`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2">
          <dt className="text-[11px] font-semibold text-[#6b4a2e]">{label}</dt>
          <dd className="village-pixel mt-0.5 text-base">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
