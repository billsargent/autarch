export interface MessageRow {
  id: number;
  conversationId: number;
  role: "system" | "user" | "assistant" | "tool" | "event";
  content: string | null;
  reasoning: string | null;
  toolCallId: string | null;
  toolName: string | null;
  toolArgs: unknown;
  toolCalls: unknown;
  createdAt: string;
}

export interface ToolExecutionRow {
  id: number;
  conversationId: number | null;
  messageId: number | null;
  tool: string;
  input: unknown;
  summary: string | null;
  output: string | null;
  status: "success" | "error" | "awaiting_approval" | "approved" | "denied" | "blocked" | "rate_limited" | "cancelled";
  riskLevel: "low" | "medium" | "high" | "critical" | "blocked";
  riskReason: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  durationMs: number | null;
}

export interface JournalEntryRow {
  id: number;
  title: string;
  body: string | null;
  category: "exploration" | "task" | "reflection" | "idea" | "system";
  status: "open" | "in_progress" | "done" | "abandoned";
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRow {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  running?: boolean;
  lastMessageId?: number;
}

export interface SettingsRow {
  id: number;
  autonomyMode: "manual" | "balanced" | "autonomous" | "unrestricted";
  modelName: string;
  maxAgentSteps: number;
  maxActionsPerHour: number;
  commandTimeoutSec: number;
  toolRetries: number;
  workspaceDir: string;
  enabledTools: string[];
  extraProtectedPaths: string[];
  systemPromptExtra: string | null;
  allowNetworkFetch: boolean;
  agentName: string;
  apiKeySet: boolean;
  apiBaseUrl: string;
  deepseekModels: string[];
  paused: boolean;
  humanAtKeyboard: boolean;
  chatMode: "agentic" | "conversation";
  minGapMinutes: number;
  maxSessionsPerDay: number;
  maxSessionMinutes: number;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  unrestrictedMode: boolean;
  allowSecretReads: boolean;
  allowFrameworkMutations: boolean;
  allowDestructiveShell: boolean;
  allowProtectedSystemOps: boolean;
  maxContextTokens: number;
  compactTargetTokens: number;
  autoCompact: boolean;
  updatedAt: string;
}

export interface JobRow {
  id: number;
  name: string;
  instruction: string;
  kind: "interval" | "daily_report" | "self_work";
  conversationId: number | null;
  intervalMinutes: number;
  maxDurationMinutes: number;
  cron: string | null;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkSessionRow {
  id: number;
  jobId: number | null;
  conversationId: number | null;
  trigger: "chat" | "approval" | "scheduled" | "report";
  status: "running" | "completed" | "terminated" | "skipped" | "failed";
  startedAt: string;
  endedAt: string | null;
  stepsUsed: number;
  actionsUsed: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  reason: string | null;
}

export interface GoalRow {
  id: number;
  title: string;
  body: string | null;
  status: "backlog" | "in_progress" | "done" | "abandoned";
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRow {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  severity: "info" | "success" | "warning" | "critical";
  source: string;
  read: boolean;
  createdAt: string;
}

export const RISK_COLORS: Record<string, string> = {
  low: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  critical: "text-red-400 bg-red-500/10 border-red-500/30",
  blocked: "text-rose-300 bg-rose-900/30 border-rose-700/40",
};

export const STATUS_COLORS: Record<string, string> = {
  success: "text-emerald-400",
  error: "text-red-400",
  awaiting_approval: "text-amber-400",
  approved: "text-emerald-400",
  denied: "text-rose-400",
  blocked: "text-rose-300",
  rate_limited: "text-orange-400",
};
