import { NextResponse } from "next/server";
import { sqlite } from "@/db";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

interface BucketRow {
  bucket: string;
  prompt: number;
  completion: number;
  total: number;
  cost: number;
  sessions: number;
  cacheHit: number;
  cacheMiss: number;
}

interface Totals {
  prompt: number;
  completion: number;
  total: number;
  cost: number;
  sessions: number;
  cacheHit: number;
  cacheMiss: number;
}

function bucketize(expr: string, limit: number): BucketRow[] {
  const rows = sqlite
    .prepare(
      `SELECT ${expr} AS bucket,
        COALESCE(SUM(prompt_tokens),0) AS prompt,
        COALESCE(SUM(completion_tokens),0) AS completion,
        COALESCE(SUM(total_tokens),0) AS total,
        COALESCE(SUM(cost_usd),0) AS cost,
        COUNT(*) AS sessions,
        COALESCE(SUM(cache_hit_tokens),0) AS cacheHit,
        COALESCE(SUM(cache_miss_tokens),0) AS cacheMiss
       FROM work_sessions
       WHERE status != 'skipped'
       GROUP BY bucket
       ORDER BY bucket DESC
       LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
  const num = (v: unknown) => Number(v ?? 0);
  return rows.map((r) => ({
    bucket: String(r.bucket),
    prompt: num(r.prompt),
    completion: num(r.completion),
    total: num(r.total),
    cost: num(r.cost),
    sessions: num(r.sessions),
    cacheHit: num(r.cacheHit),
    cacheMiss: num(r.cacheMiss),
  }));
}

function totals(sinceUnixSec?: number | null, prefixExpr?: string, prefixVal?: string): Totals {
  let sql =
    "SELECT COALESCE(SUM(prompt_tokens),0) AS prompt, COALESCE(SUM(completion_tokens),0) AS completion, COALESCE(SUM(total_tokens),0) AS total, COALESCE(SUM(cost_usd),0) AS cost, COUNT(*) AS sessions, COALESCE(SUM(cache_hit_tokens),0) AS cacheHit, COALESCE(SUM(cache_miss_tokens),0) AS cacheMiss FROM work_sessions WHERE status != 'skipped'";
  const params: unknown[] = [];
  if (sinceUnixSec != null) {
    sql += " AND started_at >= ?";
    params.push(Math.floor(sinceUnixSec));
  }
  if (prefixExpr) {
    sql += ` AND strftime(${prefixExpr}, started_at, 'unixepoch') = ?`;
    params.push(prefixVal);
  }
  const r = sqlite.prepare(sql).get(...params) as Record<string, unknown>;
  const num = (v: unknown) => Number(v ?? 0);
  return {
    prompt: num(r.prompt),
    completion: num(r.completion),
    total: num(r.total),
    cost: num(r.cost),
    sessions: num(r.sessions),
    cacheHit: num(r.cacheHit),
    cacheMiss: num(r.cacheMiss),
  };
}

export async function GET() {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);
  const weekStartSec = Math.floor((now - 7 * DAY_MS) / 1000);
  const month = new Date().toISOString().slice(0, 7);
  const year = String(new Date().getFullYear());

  const daily = bucketize("strftime('%Y-%m-%d', started_at, 'unixepoch')", 30);
  const weekly = bucketize("strftime('%Y-W%W', started_at, 'unixepoch')", 12);
  const monthly = bucketize("strftime('%Y-%m', started_at, 'unixepoch')", 12);
  const yearly = bucketize("strftime('%Y', started_at, 'unixepoch')", 5);

  const periodTotals = {
    today: totals(todayStartSec),
    week: totals(weekStartSec),
    month: totals(null, "'%Y-%m'", month),
    year: totals(null, "'%Y'", year),
  };
  const allTime = totals(null);

  return NextResponse.json({ daily, weekly, monthly, yearly, periodTotals, allTime });
}
