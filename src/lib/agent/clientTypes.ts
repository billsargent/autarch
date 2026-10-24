import type { SessionTrigger } from "./triggers";

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
  agentId: number | null;
}

export interface JournalEntryRow {
  id: number;
  title: string;
  body: string | null;
  category: "exploration" | "task" | "reflection" | "idea" | "system" | "neighbour";
  subjectAgentId?: number | null;
  status: "open" | "in_progress" | "done" | "abandoned";
  createdAt: string;
  updatedAt: string;
  agentId: number | null;
}

export interface ConversationRow {
  id: number;
  title: string;
  chatMode: "agentic" | "conversation";
  createdAt: string;
  updatedAt: string;
  running?: boolean;
  lastMessageId?: number;
  agentId: number | null;
  // Its own provider and model, over the villager's (#64).
  providerId?: number | null;
  model?: string | null;
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
  townDailyBudgetUsd: number | null;
  bedtime: string;
  wakeTime: string;
  hiringMode: "ask" | "auto";
  maxPopulation: number;
  meetingCostCapUsd: number;
  awayUntil: string | null;
  awayStartedAt: string | null;
  awaySpendCapUsd: number;
  voteCostCapUsd: number;
  extraProtectedPaths: string[];
  systemPromptExtra: string | null;
  staticCorePrompt: string | null;
  persona: string | null;
  workWindowPrompt: string | null;
  focusedChatPrompt: string | null;
  truncationMessage: string | null;
  allowNetworkFetch: boolean;
  agentName: string;
  apiKeySet: boolean;
  calendarSet: boolean;
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
  thinkingEnabled: boolean;
  reasoningEffort: string;
  maxOutputTokens: number;
  cacheHitInputPricePerMTok: number;
  updatedAt: string;
}

export interface JobRow {
  id: number;
  name: string;
  instruction: string;
  kind: "interval" | "daily_report" | "self_work" | "daydream";
  conversationId: number | null;
  intervalMinutes: number;
  maxDurationMinutes: number;
  reportSessionTitle: string | null;
  cron: string | null;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  agentId: number | null;
}

export interface WorkSessionRow {
  id: number;
  jobId: number | null;
  conversationId: number | null;
  trigger: SessionTrigger;
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
  conversationId: number | null;
  createdAt: string;
  updatedAt: string;
  agentId: number | null;
  // Where the work stands, kept by the villager (#68).
  notes?: string | null;
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
  agentId: number | null;
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
  cancelled: "text-neutral-400",
};

// A villager (#55), as /api/agents lists them: the stored row plus what they're
// up to right now.
export interface AgentRow {
  id: number;
  name: string;
  role: string;
  persona: string | null;
  character: string;
  color: string;
  model: string | null;
  enabledTools: string[] | null;
  home: string;
  isMayor: boolean;
  status: "active" | "paused" | "dismissed";
  pausedBy: "owner" | "mayor" | null;
  tier: "mayor" | "director" | "worker";
  area: string | null;
  managerId: number | null;
  providerId?: number | null;
  inMeeting?: boolean;
  daydream?: boolean;
  dailyBudgetUsd: number | null;
  maxActionsPerHour: number | null;
  createdAt: string;
  updatedAt: string;
  working: boolean;
  waiting: number;
  spentToday: number;
  focusConversationId: number | null;
  lastSaid: string | null;
  lastSaidAt: number | null;
  talkingWith: number | null;
}

// A hire request (#99): a drafted villager, the Mayor's interview, and what
// became of it.
export interface HireRequestRow {
  id: number;
  proposedBy: number | null;
  draft: {
    name: string;
    role?: string | null;
    persona?: string | null;
    tier?: "director" | "worker";
    area?: string | null;
    managerId?: number | null;
    enabledTools?: string[] | null;
    dailyBudgetUsd?: number | null;
    character?: string | null;
  };
  reason: string | null;
  status: "interviewing" | "awaiting_owner" | "hired" | "declined";
  interview: string | null;
  verdict: "recommend" | "reject" | "unsure" | null;
  conversationId: number | null;
  agentId: number | null;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}
