"use client";

import { useCallback, useEffect, useState } from "react";

// A live view of the machine the agent runs on. Shared by the System monitor
// page and the observatory.

export interface SystemStatus {
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

// The 1-minute load as a share of the cores, in percent.
export function loadPercent(s: SystemStatus): number {
  return (s.loadavg[0] / Math.max(1, s.cpuCount)) * 100;
}

export function useSystemStatus(autoRefresh: boolean) {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/system/status").then((r) => r.json());
    setStatus(res);
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    if (!autoRefresh) return () => clearTimeout(first);
    const id = setInterval(reload, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload, autoRefresh]);

  return { status, reload };
}
