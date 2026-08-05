"use client";

import { useCallback, useEffect, useState } from "react";

interface StatusPayload {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  uptimePretty: string;
  cpuModel: string;
  cpuCount: number;
  loadavg: number[];
  totalMemMB: number;
  freeMemMB: number;
  usedMemPercent: number;
  disk: string;
  topProcesses: string;
  timestamp: string;
}

function Bar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export default function MonitorView() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/system/status").then((r) => r.json());
    setStatus(res);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    if (!autoRefresh) return () => clearTimeout(first);
    const id = setInterval(load, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load, autoRefresh]);

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">System monitor</h1>
            <p className="mt-1 text-sm text-neutral-500">Live view of the system the agent is running on.</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            auto-refresh
          </label>
        </div>

        {!status && <p className="mt-6 text-sm text-neutral-500">Loading…</p>}

        {status && (
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="col-span-2 rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-xs text-neutral-400">
              <p>
                <span className="text-neutral-200">{status.hostname}</span> · {status.platform} {status.release} ({status.arch})
              </p>
              <p className="mt-1">Uptime: {status.uptimePretty}</p>
              <p className="mt-1">CPU: {status.cpuModel} × {status.cpuCount}</p>
              <p className="mt-1">Load average: {status.loadavg.map((n) => n.toFixed(2)).join(" / ")}</p>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <p className="mb-2 text-xs font-semibold text-neutral-400">Memory</p>
              <Bar percent={status.usedMemPercent} color={status.usedMemPercent > 85 ? "bg-red-500" : "bg-cyan-500"} />
              <p className="mt-2 text-xs text-neutral-500">
                {status.usedMemPercent}% used · {(status.totalMemMB - status.freeMemMB).toLocaleString()} / {status.totalMemMB.toLocaleString()} MB
              </p>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <p className="mb-2 text-xs font-semibold text-neutral-400">Load (1 min / cores)</p>
              <Bar
                percent={(status.loadavg[0] / status.cpuCount) * 100}
                color={status.loadavg[0] / status.cpuCount > 0.85 ? "bg-red-500" : "bg-emerald-500"}
              />
              <p className="mt-2 text-xs text-neutral-500">{status.loadavg[0].toFixed(2)} / {status.cpuCount} cores</p>
            </div>

            <div className="col-span-2 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <p className="mb-2 text-xs font-semibold text-neutral-400">Disk usage</p>
              <pre className="overflow-x-auto whitespace-pre font-mono text-[11px] text-neutral-400">{status.disk}</pre>
            </div>

            <div className="col-span-2 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <p className="mb-2 text-xs font-semibold text-neutral-400">Top processes</p>
              <pre className="overflow-x-auto whitespace-pre font-mono text-[11px] text-neutral-400">{status.topProcesses}</pre>
            </div>

            <p className="col-span-2 text-right text-[10px] text-neutral-600">last updated {new Date(status.timestamp).toLocaleTimeString()}</p>
          </div>
        )}
      </div>
    </div>
  );
}
