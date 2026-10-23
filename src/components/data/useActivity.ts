"use client";

import { useCallback, useEffect, useState } from "react";
import type { ToolExecutionRow } from "@/lib/agent/clientTypes";

// The activity log: every tool call the agent has attempted, plus today's
// totals. Shared by the Activity page and the guard tower.

export interface TodayStats {
  today: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    actionsUsed: number;
    stepsUsed: number;
  };
  todaySessionCount: number;
}

export const ACTIVITY_FILTERS = [
  "all",
  "success",
  "error",
  "awaiting_approval",
  "approved",
  "denied",
  "blocked",
  "rate_limited",
  "cancelled",
] as const;

export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export function useActivity() {
  const [rows, setRows] = useState<ToolExecutionRow[]>([]);
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [actRes, statsRes] = await Promise.all([
      fetch("/api/activity?limit=150").then((r) => r.json()),
      fetch("/api/stats").then((r) => r.json()),
    ]);
    setRows(actRes.executions || []);
    setStats(statsRes);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    const id = setInterval(reload, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload]);

  return { rows, stats, loaded, reload };
}

export function filterActivity(rows: ToolExecutionRow[], filter: ActivityFilter): ToolExecutionRow[] {
  return filter === "all" ? rows : rows.filter((r) => r.status === filter);
}
