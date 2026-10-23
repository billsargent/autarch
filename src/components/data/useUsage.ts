"use client";

import { useCallback, useEffect, useState } from "react";

// Token and cost totals by period. Shared by the Usage page and the vault.

export interface UsageTotals {
  prompt: number;
  completion: number;
  total: number;
  cost: number;
  sessions: number;
  cacheHit: number;
  cacheMiss: number;
}

export interface UsageBucket extends UsageTotals {
  bucket: string;
}

export interface UsageData {
  daily: UsageBucket[];
  weekly: UsageBucket[];
  monthly: UsageBucket[];
  yearly: UsageBucket[];
  periodTotals: {
    today: UsageTotals;
    week: UsageTotals;
    month: UsageTotals;
    year: UsageTotals;
  };
  allTime: UsageTotals;
}

export const USAGE_PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export function fmtTokens(n: number): string {
  return n.toLocaleString();
}

export function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

// "73%", or "—" when nothing was cached either way.
export function cacheHitRate(t: Pick<UsageTotals, "cacheHit" | "cacheMiss">): string {
  const all = t.cacheHit + t.cacheMiss;
  return all > 0 ? `${Math.round((t.cacheHit / all) * 100)}%` : "—";
}

export function usageCards(data: UsageData | null): Array<{ label: string; t: UsageTotals | undefined }> {
  return [
    { label: "Today", t: data?.periodTotals.today },
    { label: "This week", t: data?.periodTotals.week },
    { label: "This month", t: data?.periodTotals.month },
    { label: "This year", t: data?.periodTotals.year },
    { label: "All-time", t: data?.allTime },
  ];
}

export function useUsage() {
  const [data, setData] = useState<UsageData | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/usage").then((r) => r.json());
    setData(res);
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    const id = setInterval(reload, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload]);

  return { data, reload };
}
