"use client";

import { useCallback, useEffect, useState } from "react";
import type { ToolExecutionRow } from "@/lib/agent/clientTypes";
import { RISK_COLORS, STATUS_COLORS } from "@/lib/agent/clientTypes";

function formatInput(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length) return null;
  return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
}

export default function ApprovalsView() {
  const [pending, setPending] = useState<ToolExecutionRow[]>([]);
  const [recent, setRecent] = useState<ToolExecutionRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/approvals").then((r) => r.json());
    setPending(res.pending || []);
    setRecent(res.recent || []);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  async function decide(id: number, decision: "approved" | "denied") {
    setBusyId(id);
    try {
      await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: note[id] }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-semibold">Approvals</h1>
        <p className="mt-1 text-sm text-neutral-500">
          High-risk or critical actions never run automatically. Review and approve or deny each one below.
        </p>

        <div className="mt-6 space-y-3">
          {pending.length === 0 && (
            <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-500">
              Nothing waiting on you right now.
            </p>
          )}
          {pending.map((p) => (
            <div key={p.id} className="rounded-xl border border-amber-800/50 bg-amber-950/10 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold">🔧 {p.tool}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${RISK_COLORS[p.riskLevel]}`}>
                  {p.riskLevel} risk
                </span>
              </div>
              {formatInput(p.input) && (
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-950/60 p-2 font-mono text-[11px] text-neutral-400">
                  {formatInput(p.input)}
                </pre>
              )}
              <p className="mt-2 text-xs text-neutral-400">{p.riskReason}</p>
              <p className="mt-1 text-[10px] text-neutral-600">requested {new Date(p.requestedAt).toLocaleString()}</p>
              <input
                value={note[p.id] || ""}
                onChange={(e) => setNote((prev) => ({ ...prev, [p.id]: e.target.value }))}
                placeholder="Optional note (shown to the agent, especially useful when denying)"
                className="mt-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs outline-none"
              />
              <div className="mt-3 flex gap-2">
                <button
                  disabled={busyId === p.id}
                  onClick={() => decide(p.id, "approved")}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  ✅ Approve &amp; run
                </button>
                <button
                  disabled={busyId === p.id}
                  onClick={() => decide(p.id, "denied")}
                  className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                >
                  ❌ Deny
                </button>
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-10 text-sm font-semibold text-neutral-400">Recent decisions</h2>
        <div className="mt-3 space-y-2">
          {recent
            .filter((r) => r.status !== "awaiting_approval")
            .slice(0, 15)
            .map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs">
                <span className="font-mono">{r.tool}</span>
                <span className={STATUS_COLORS[r.status]}>{r.status}</span>
                <span className="text-neutral-600">{new Date(r.requestedAt).toLocaleTimeString()}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
