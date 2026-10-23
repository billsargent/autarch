// Village-palette wording and colors for risk levels and tool-call statuses,
// shared by the approval prompt and the rooms.
import type { ToolExecutionRow } from "@/lib/agent/clientTypes";

export const RISK_WORDS: Record<string, { label: string; short: string; tone: string }> = {
  low: { label: "Low risk", short: "low", tone: "#5f8a3c" },
  medium: { label: "Medium risk — changes files or makes network requests", short: "medium", tone: "#c58a1b" },
  high: { label: "High risk — changes the system", short: "high", tone: "#d9643a" },
  critical: { label: "Critical — elevated, destructive or hard to undo", short: "critical", tone: "#b3261e" },
  blocked: { label: "Normally blocked — a supervisor override is on", short: "blocked", tone: "#7a1712" },
};

export const STATUS_WORDS: Record<ToolExecutionRow["status"], { label: string; tone: string }> = {
  success: { label: "done", tone: "#3f6b22" },
  error: { label: "failed", tone: "#b3261e" },
  awaiting_approval: { label: "waiting on you", tone: "#c58a1b" },
  approved: { label: "approved", tone: "#3f6b22" },
  denied: { label: "denied", tone: "#9a2a4a" },
  blocked: { label: "blocked", tone: "#7a1712" },
  rate_limited: { label: "rate-limited", tone: "#d9643a" },
  cancelled: { label: "cancelled", tone: "#6b4a2e" },
};

// What the agent wants to do, in words, plus the exact detail.
export function describeToolCall(p: ToolExecutionRow): { headline: string; detail: string } {
  const input = (p.input ?? {}) as Record<string, unknown>;
  if (typeof input.command === "string") return { headline: "run a command", detail: input.command };
  if (typeof input.path === "string") return { headline: `use ${p.tool} on a file`, detail: JSON.stringify(input, null, 2) };
  return { headline: `use ${p.tool}`, detail: JSON.stringify(input, null, 2) };
}
