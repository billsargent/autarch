"use client";

import { useState } from "react";
import type { ToolExecutionRow } from "@/lib/agent/clientTypes";
import { formatToolInput, useApprovals, type Decision } from "../../data/useApprovals";
import ParchmentDialog from "../ParchmentDialog";
import MayorsLedger from "./MayorsLedger";
import { RISK_WORDS, STATUS_WORDS } from "../tones";
import type { RoomProps } from "./types";

// The town hall: the clerk's desk holds every action waiting on the owner,
// and the records cabinet keeps recent decisions (same as the Approvals page,
// useApprovals); the Mayor's ledger holds the settings (MayorsLedger).
// Approvals and settings are always the human's.

export default function TownHallRoom({ action, onClose }: RoomProps) {
  return action === "settings.open" ? <MayorsLedger onClose={onClose} /> : <Approvals action={action} onClose={onClose} />;
}

function Approvals({ action, onClose }: RoomProps) {
  const { pending, decided, loaded, decide } = useApprovals();
  const [view, setView] = useState<"desk" | "records">(action === "approvals.records" ? "records" : "desk");

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
        <button onClick={() => setView("records")} className="village-btn ml-auto px-3 py-2 text-xs">
          🗄 Records cabinet
        </button>
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
          <Request key={p.id} p={p} onDecide={(d, note) => decide(p.id, d, note)} />
        ))}
      </ul>
    </ParchmentDialog>
  );
}

function Request({ p, onDecide }: { p: ToolExecutionRow; onDecide: (d: Decision, note?: string) => Promise<{ ok: true } | { ok: false; error: string }> }) {
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
        <span className="font-mono text-sm font-semibold">{p.tool}</span>
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
