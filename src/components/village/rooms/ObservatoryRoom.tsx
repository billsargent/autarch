"use client";

import { useState } from "react";
import { loadPercent, useSystemStatus } from "../../data/useSystemStatus";
import ParchmentDialog from "../ParchmentDialog";
import type { RoomProps } from "./types";

// The observatory: the star charts are the system monitor — the machine the
// agents live on. Same data as the System monitor page (useSystemStatus).

function Gauge({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  const p = Math.min(100, Math.max(0, percent));
  const tone = p > 85 ? "#b3261e" : p > 60 ? "#c58a1b" : "#5f8a3c";
  return (
    <div className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-3">
      <p className="text-xs font-semibold">{label}</p>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(p)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2 h-3 overflow-hidden rounded-sm border-2 border-[#3b2716] bg-[#e8dcc2]"
      >
        <div className="h-full" style={{ width: `${p}%`, background: tone }} />
      </div>
      <p className="mt-1.5 text-[11px] text-[#6b4a2e]">{detail}</p>
    </div>
  );
}

export default function ObservatoryRoom({ onClose }: RoomProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { status, reload } = useSystemStatus(autoRefresh);

  return (
    <ParchmentDialog
      kicker="The observatory"
      title="Star charts — the machine"
      onClose={onClose}
      wide
      footer={
        <>
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" name="autoRefresh" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Keep watching (every 15 s)
          </label>
          <button onClick={() => void reload()} className="village-btn ml-auto px-3 py-2 text-xs">
            ↻ Look again
          </button>
        </>
      }
    >
      {!status && <p className="text-sm">Pointing the telescope…</p>}
      {status && (
        <div className="space-y-3">
          <div className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-3 text-xs">
            <p>
              <span className="village-pixel text-sm">{status.hostname}</span> · {status.platform} {status.release} ({status.arch})
            </p>
            <p className="mt-1">Up for {status.uptimePretty}</p>
            <p className="mt-0.5">
              {status.cpuModel} × {status.cpuCount}
            </p>
            <p className="mt-0.5">Load average: {status.loadavg.map((n) => n.toFixed(2)).join(" / ")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Gauge
              label="Memory"
              percent={status.usedMemPercent}
              detail={`${status.usedMemPercent}% used · ${(status.totalMemMB - status.freeMemMB).toLocaleString()} / ${status.totalMemMB.toLocaleString()} MB`}
            />
            <Gauge
              label="Load (1 min / cores)"
              percent={loadPercent(status)}
              detail={`${status.loadavg[0].toFixed(2)} / ${status.cpuCount} cores`}
            />
          </div>
          <section>
            <h3 className="village-pixel mb-1 text-xs">Disks</h3>
            <pre className="overflow-x-auto whitespace-pre rounded border-2 border-[#3b2716] bg-[#1d1a16] p-2 font-mono text-[11px] text-[#f4ead5]">
              {status.disk}
            </pre>
          </section>
          <section>
            <h3 className="village-pixel mb-1 text-xs">Busiest processes</h3>
            <pre className="overflow-x-auto whitespace-pre rounded border-2 border-[#3b2716] bg-[#1d1a16] p-2 font-mono text-[11px] text-[#f4ead5]">
              {status.topProcesses}
            </pre>
          </section>
          <p className="text-right text-[11px] text-[#6b4a2e]">Last looked at {new Date(status.timestamp).toLocaleTimeString()}</p>
        </div>
      )}
    </ParchmentDialog>
  );
}
