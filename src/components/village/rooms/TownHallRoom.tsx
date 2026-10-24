"use client";

import { useState } from "react";
import type { HireRequestRow, ToolExecutionRow } from "@/lib/agent/clientTypes";
import { useHires } from "../../data/useHires";
import { formatToolInput, useApprovals, type Decision } from "../../data/useApprovals";
import ParchmentDialog from "../ParchmentDialog";
import MayorsLedger from "./MayorsLedger";
import VillagerPortrait from "../VillagerPortrait";
import { useVillagers } from "../../data/useVillagers";
import type { AgentRow } from "@/lib/agent/clientTypes";
import { RISK_WORDS, STATUS_WORDS } from "../tones";
import type { RoomProps } from "./types";

// The town hall: the clerk's desk holds every action waiting on the owner,
// and the records cabinet keeps recent decisions (same as the Approvals page,
// useApprovals); the Mayor's ledger holds the settings (MayorsLedger).
// Approvals and settings are always the human's. Hire requests (#99) wait at
// the clerk's desk too.

export default function TownHallRoom({ action, onClose }: RoomProps) {
  return action === "settings.open" ? <MayorsLedger onClose={onClose} /> : <Approvals action={action} onClose={onClose} />;
}

function Approvals({ action, onClose }: RoomProps) {
  const { pending, decided, loaded, decide } = useApprovals();
  const { byId } = useVillagers(15000);
  const hires = useHires();
  const [view, setView] = useState<"desk" | "records" | "hires">(action === "approvals.records" ? "records" : action === "hires.open" ? "hires" : "desk");

  if (view === "hires") {
    return (
      <ParchmentDialog
        kicker="The town hall"
        title="Hire requests"
        onClose={onClose}
        wide
        footer={
          <button onClick={() => setView("desk")} className="village-btn ml-auto px-3 py-2 text-xs">
            ← The clerk&apos;s desk
          </button>
        }
      >
        <p className="mb-3 text-xs text-[#6b4a2e]">
          New villagers the Mayor or a director would like to take on, with the Mayor&apos;s interview. You can change their
          personality and budget before saying yes.
        </p>
        {!hires.loaded && <p className="text-sm">Fetching the applications…</p>}
        {hires.loaded && hires.requests.length === 0 && (
          <p className="rounded border-2 border-dashed border-[#c9b27a] p-4 text-center text-sm">Nobody has asked to hire anyone yet.</p>
        )}
        <ul className="space-y-3">
          {hires.requests.map((r) => (
            <HireCard key={r.id} r={r} byId={byId} onDecide={(a, d) => hires.decide(r.id, a, d)} />
          ))}
        </ul>
      </ParchmentDialog>
    );
  }

  if (view === "records") {
    return (
      <ParchmentDialog
        kicker="The town hall"
        title="Records cabinet"
        onClose={onClose}
        wide
        footer={
          <button onClick={() => setView("desk")} className="village-btn ml-auto px-3 py-2 text-xs">
            The clerk&apos;s desk{pending.length > 0 ? ` (${pending.length} waiting)` : ""}
          </button>
        }
      >
        <p className="mb-3 text-xs text-[#6b4a2e]">Recent requests and what became of them.</p>
        {!loaded && <p className="text-sm">Opening the drawers…</p>}
        {loaded && decided.length === 0 && <p className="text-sm">No decisions on record yet.</p>}
        <ul className="divide-y-2 divide-[#e6d6b0] rounded border-2 border-[#3b2716] bg-[#fffaf0]">
          {decided.slice(0, 15).map((r) => {
            const status = STATUS_WORDS[r.status] ?? { label: r.status, tone: "#6b4a2e" };
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5 text-xs">
                {byId(r.agentId) && <span className="text-[#6b4a2e]">{byId(r.agentId)!.name}:</span>}
                <span className="font-mono font-semibold">{r.tool}</span>
                <span className="font-semibold" style={{ color: status.tone }}>
                  {status.label}
                </span>
                {r.resolvedBy && <span className="text-[#6b4a2e]">by {r.resolvedBy}</span>}
                <span className="ml-auto text-[#6b4a2e]">{new Date(r.requestedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </li>
            );
          })}
        </ul>
      </ParchmentDialog>
    );
  }

  return (
    <ParchmentDialog
      kicker="The town hall"
      title="The clerk's desk"
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={() => setView("hires")} className={`village-btn px-3 py-2 text-xs ${hires.waiting.length ? "village-btn-go" : ""}`}>
            📜 Hire requests{hires.waiting.length > 0 ? ` (${hires.waiting.length} waiting)` : ""}
          </button>
          <button onClick={() => setView("records")} className="village-btn ml-auto px-3 py-2 text-xs">
            🗄 Records cabinet
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-[#6b4a2e]">
        High-risk and critical actions never run on their own. Read exactly what each one would do, then say yes or no.
      </p>
      {!loaded && <p className="text-sm">Sorting the papers…</p>}
      {loaded && pending.length === 0 && (
        <p className="rounded border-2 border-dashed border-[#c9b27a] p-4 text-center text-sm">Nothing waiting on you right now.</p>
      )}
      <ul className="space-y-3">
        {pending.map((p) => (
          <Request key={p.id} p={p} asker={byId(p.agentId)} onDecide={(d, note) => decide(p.id, d, note)} />
        ))}
      </ul>
    </ParchmentDialog>
  );
}

function Request({
  p,
  asker,
  onDecide,
}: {
  p: ToolExecutionRow;
  asker: AgentRow | null;
  onDecide: (d: Decision, note?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const risk = RISK_WORDS[p.riskLevel] ?? RISK_WORDS.critical;
  const input = formatToolInput(p.input);

  async function decide(d: Decision) {
    setBusy(true);
    setError(null);
    const res = await onDecide(d, note || undefined);
    if (!res.ok) setError(res.error);
    setBusy(false);
  }

  return (
    <li className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm">
          {asker && (
            <>
              <VillagerPortrait character={asker.character} color={asker.color} size={20} />
              <span className="font-semibold">{asker.name} asks to use</span>
            </>
          )}
          <span className="font-mono font-semibold">{p.tool}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: risk.tone }}>
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: risk.tone }} />
          {risk.label}
        </span>
      </div>
      {input && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border-2 border-[#3b2716] bg-[#1d1a16] p-2 font-mono text-[11px] text-[#f4ead5]">
          {input}
        </pre>
      )}
      {p.riskReason && <p className="mt-2 text-xs text-[#6b4a2e]">{p.riskReason}</p>}
      <p className="mt-1 text-[11px] text-[#6b4a2e]">Asked {new Date(p.requestedAt).toLocaleString()}</p>
      <input
        name={`note-${p.id}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for the agent (useful when saying no)"
        className="mt-2 w-full rounded border-2 border-[#3b2716] bg-white px-2 py-1.5 text-xs outline-none"
      />
      {error && <p className="mt-2 text-xs text-[#b3261e]">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button disabled={busy} onClick={() => void decide("approved")} className="village-btn village-btn-go px-3 py-1.5 text-xs">
          ✅ Approve &amp; run
        </button>
        <button disabled={busy} onClick={() => void decide("denied")} className="village-btn village-btn-danger px-3 py-1.5 text-xs">
          ❌ Deny
        </button>
      </div>
    </li>
  );
}

const HIRE_STATUS: Record<HireRequestRow["status"], { label: string; tone: string }> = {
  interviewing: { label: "The Mayor is interviewing them", tone: "#8a5a2b" },
  awaiting_owner: { label: "Waiting for you", tone: "#c58a1b" },
  hired: { label: "Hired", tone: "#3d7a2a" },
  declined: { label: "Declined", tone: "#b3261e" },
};

function HireCard({
  r,
  byId,
  onDecide,
}: {
  r: HireRequestRow;
  byId: (id: number | null) => AgentRow | null | undefined;
  onDecide: (action: "approve" | "decline", draft?: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const d = r.draft;
  const [persona, setPersona] = useState(d.persona ?? "");
  const [budget, setBudget] = useState(d.dailyBudgetUsd != null ? String(d.dailyBudgetUsd) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drafter = byId(r.proposedBy);
  const manager = byId(d.managerId ?? null);
  const status = HIRE_STATUS[r.status];
  // Waiting on the owner, or turned down by the Mayor (the owner can overrule him).
  const open = r.status === "awaiting_owner" || (r.status === "declined" && r.decidedBy === "mayor");

  async function decide(action: "approve" | "decline") {
    setBusy(true);
    setError(null);
    const edits = action === "approve" ? { persona: persona.trim() || null, dailyBudgetUsd: budget.trim() === "" ? null : Number(budget) } : undefined;
    const res = await onDecide(action, edits);
    if (!res.ok) setError(res.error.charAt(0).toUpperCase() + res.error.slice(1));
    setBusy(false);
  }

  return (
    <li className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="village-pixel">{d.name}</span>{" "}
          <span className="text-xs text-[#6b4a2e]">
            · {d.role ?? "Villager"} · {d.tier === "director" ? "Director" : `🦺 Worker${manager ? ` for ${manager.name}` : ""}`}
            {d.area ? ` · ${d.area}` : ""}
          </span>
        </p>
        <span className="text-xs font-semibold" style={{ color: status.tone }}>
          {status.label}
          {r.decidedBy === "mayor" && r.status !== "awaiting_owner" ? " (by the Mayor)" : ""}
        </span>
      </div>
      <p className="mt-1 text-xs text-[#6b4a2e]">
        Drafted by {drafter ? drafter.name : "you"} · {new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </p>
      {r.reason && <p className="mt-1 text-xs">Why: {r.reason}</p>}
      <p className="mt-1 text-[11px] text-[#6b4a2e]">
        Tools: <span className="font-mono">{(d.enabledTools ?? []).join(", ") || "none"}</span>
      </p>
      {r.interview && (
        <div className="mt-2 rounded border-2 border-[#d8c49a] bg-white/60 p-2 text-xs">
          <p className="font-semibold">
            The Mayor&apos;s interview{" "}
            {r.verdict === "recommend" ? "👍 recommends" : r.verdict === "reject" ? "👎 doesn't recommend" : "🤔 no clear verdict"}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{r.interview.replace(/\s*VERDICT:\s*(RECOMMEND|REJECT)\s*$/i, "")}</p>
        </div>
      )}
      {open ? (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem]">
            <label className="block text-xs font-semibold">
              Personality
              <textarea name={`hire-persona-${r.id}`} value={persona} onChange={(e) => setPersona(e.target.value)} rows={3} className="mt-1 w-full resize-y rounded border-2 border-[#3b2716] bg-white px-2 py-1.5 text-xs font-normal outline-none" />
            </label>
            <label className="block text-xs font-semibold">
              Daily budget (USD)
              <input name={`hire-budget-${r.id}`} type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="None of their own" className="mt-1 w-full rounded border-2 border-[#3b2716] bg-white px-2 py-1.5 text-xs font-normal outline-none" />
            </label>
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-[#b3261e]">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button disabled={busy} onClick={() => void decide("approve")} className="village-btn village-btn-go px-3 py-1.5 text-xs">
              ✅ Welcome {d.name}
            </button>
            {r.status === "awaiting_owner" && (
              <button disabled={busy} onClick={() => void decide("decline")} className="village-btn village-btn-danger px-3 py-1.5 text-xs">
                ❌ Decline
              </button>
            )}
          </div>
        </>
      ) : (
        d.persona && <p className="mt-1 text-xs text-[#6b4a2e]">Personality: {d.persona}</p>
      )}
    </li>
  );
}
