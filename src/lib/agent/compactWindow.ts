// Pure helpers for context compaction: token estimates and the keep-window
// (which messages stay verbatim vs get summarized). No database or model
// access, so they can be tested without touching a real install.
import type { HistoryRow } from "./messageHistory";

// Rough token estimator. DeepSeek docs (quick_start/token_usage) say ~1 English
// char ≈ 0.3 token (≈3.3 chars/token). 4 chars/token under-estimated real usage
// by ~18%, so compaction was triggering later than the real token budget.
const CHAR_PER_TOKEN = 3.3;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHAR_PER_TOKEN);
}

export function rowTokens(r: HistoryRow): number {
  let n = estimateTokens(r.content ?? "");
  if (r.role === "assistant" && Array.isArray(r.toolCalls)) {
    try {
      n += estimateTokens(JSON.stringify(r.toolCalls));
    } catch {
      /* ignore */
    }
  }
  return n;
}

export function totalHistoryTokens(rows: HistoryRow[]): number {
  return rows.reduce((s, r) => s + rowTokens(r), 0);
}

// Pure windowing helper: pick the newest rows that fit within `targetTokens`
// (always keeping at least the newest message). Everything not returned is what
// gets summarized. Exposed for testing.
export function selectKeepWindow(rows: HistoryRow[], targetTokens: number): HistoryRow[] {
  const keep: HistoryRow[] = [];
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = rowTokens(rows[i]);
    if (used + t > targetTokens && keep.length > 0) break;
    keep.unshift(rows[i]);
    used += t;
  }
  return keep;
}

export interface CompactionSplit {
  keep: HistoryRow[];
  toSummarize: HistoryRow[];
}

// Decide what stays verbatim vs what gets summarized. Any leading tool-result
// rows of the keep window are folded into the summarize set: they can only be
// the results of assistant tool_calls that were just summarized (a tool row
// always immediately follows its assistant tool_calls), and leaving them in
// `keep` would orphan them — the sanitizer would drop them and the outcome
// would be lost entirely. Exposed for testing.
export function splitForCompaction(rows: HistoryRow[], targetTokens: number): CompactionSplit {
  const keepRaw = selectKeepWindow(rows, targetTokens);
  let i = 0;
  while (i < keepRaw.length && keepRaw[i].role === "tool") i++;
  const extraSummarize = keepRaw.slice(0, i);
  const keep = keepRaw.slice(i);
  const keepIds = new Set(keep.map((r) => r.id));
  const toSummarize = [...rows.filter((r) => !keepIds.has(r.id)), ...extraSummarize];
  return { keep, toSummarize };
}
