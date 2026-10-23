"use client";

import { useState } from "react";
import type { ToolExecutionRow } from "@/lib/agent/clientTypes";
import { RISK_WORDS, describeToolCall as describe } from "./tones";

interface ApprovalPromptProps {
  agentName: string;
  pending: ToolExecutionRow[];
  onDecided: () => void;
  onLater: () => void;
}

// Pops over the village whenever the agent is waiting on the human. Friendly
// wording on top, but the exact command and the risk level are always shown.
export default function ApprovalPrompt({ agentName, pending, onDecided, onLater }: ApprovalPromptProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = pending[0];
  if (!p) return null;
  const { headline, detail } = describe(p);
  const risk = RISK_WORDS[p.riskLevel] ?? RISK_WORDS.critical;

  async function decide(decision: "approved" | "denied") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${p.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      if (!res.ok) {
        // E.g. paused, or already decided elsewhere. Refresh either way so the
        // prompt shows the current state; the error stays visible.
        const data = await res.json().catch(() => ({}));
        setError(data.error || `HTTP ${res.status}`);
      } else {
        setNote("");
      }
      onDecided();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <div className="village-panel w-full max-w-lg rounded-lg border-4 border-[#3b2716] bg-[#f4ead5] text-[#3b2716] shadow-2xl">
        <div className="flex items-center justify-between border-b-4 border-[#3b2716] bg-[#6b4a2e] px-4 py-2 text-[#f4ead5]">
          <span className="village-pixel text-xs">Town hall</span>
          {pending.length > 1 && <span className="text-xs">1 of {pending.length} waiting</span>}
        </div>
        <div className="space-y-3 p-4">
          <h2 id="approval-title" className="village-pixel text-lg">
            {agentName} wants to {headline} — okay?
          </h2>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border-2 border-[#3b2716] bg-[#1d1a16] p-3 font-mono text-xs text-[#f4ead5]">
            {detail}
          </pre>
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: risk.tone }}>
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: risk.tone }} />
            {risk.label}
          </p>
          {p.riskReason && <p className="text-xs text-[#6b4a2e]">{p.riskReason}</p>}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note for the agent (useful when saying no)"
            className="w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm outline-none"
          />
          {error && <p className="text-xs text-[#b3261e]">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button disabled={busy} onClick={() => decide("approved")} className="village-btn village-btn-go px-4 py-2 text-sm">
              Yes, go ahead
            </button>
            <button disabled={busy} onClick={() => decide("denied")} className="village-btn village-btn-danger px-4 py-2 text-sm">
              No
            </button>
            <button disabled={busy} onClick={onLater} className="village-btn ml-auto px-3 py-2 text-xs">
              Decide later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
