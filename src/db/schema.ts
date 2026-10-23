import {
  sqliteTable,
  integer,
  text,
  real,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// The villagers (#55). Each is an agent with its own name, personality, look,
// model, tools and home folder; the first one is the Mayor. Town-wide things
// (the API key, safety policy, the tool policy) stay in agent_settings.
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role").notNull().default("Villager"),
  // Personality in the owner's words; empty = the default villager.
  persona: text("persona"),
  // Sprite key (src/lib/agent/villagerLooks.ts) and accent colour.
  character: text("character").notNull().default("villager"),
  color: text("color").notNull().default("#4f86c6"),
  // Model; empty = the town default (agent_settings.model_name).
  model: text("model"),
  // Tools this villager may use, within the town's tool policy; empty = all of it.
  enabledTools: text("enabled_tools", { mode: "json" }),
  // Home folder inside the town workspace ("" = the workspace itself).
  home: text("home").notNull().default(""),
  isMayor: integer("is_mayor", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["active", "paused", "dismissed"] }).notNull().default("active"),
  // Limits (#60); empty = no cap of its own.
  dailyBudgetUsd: real("daily_budget_usd"),
  maxActionsPerHour: integer("max_actions_per_hour"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default("New session"),
  summary: text("summary"),
  compactedThroughId: integer("compacted_through_id"),
  chatMode: text("chat_mode", { enum: ["agentic", "conversation"] }).notNull().default("agentic"),
  // For a thread between two villagers (#57): the one asking. The owner
  // (agent_id) is the one being asked.
  partnerAgentId: integer("partner_agent_id").references(() => agents.id, { onDelete: "set null" }),
  // The villager this belongs to (#56).
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  instruction: text("instruction").notNull().default(""),
  kind: text("kind", { enum: ["interval", "daily_report", "self_work"] }).notNull().default("interval"),
  conversationId: integer("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  intervalMinutes: integer("interval_minutes").notNull().default(60),
  maxDurationMinutes: integer("max_duration_minutes").notNull().default(10),
  reportSessionTitle: text("report_session_title"),
  cron: text("cron"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  nextRunAt: integer("next_run_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  // The villager this belongs to (#56).
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const workSessions = sqliteTable("work_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }),
  conversationId: integer("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  trigger: text("trigger", { enum: ["chat", "approval", "scheduled", "report", "message"] }).notNull(),
  status: text("status", {
    enum: ["running", "completed", "terminated", "skipped", "failed"],
  })
    .notNull()
    .default("running"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  stepsUsed: integer("steps_used").notNull().default(0),
  actionsUsed: integer("actions_used").notNull().default(0),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  cacheHitTokens: integer("cache_hit_tokens").notNull().default(0),
  cacheMissTokens: integer("cache_miss_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  reason: text("reason"),
  // Turn lock and Stop (src/lib/agent/turnLock.ts).
  heartbeatAt: integer("heartbeat_at", { mode: "timestamp" }),
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
  // The villager this belongs to (#56).
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["system", "user", "assistant", "tool", "event"] }).notNull(),
  content: text("content"),
  reasoning: text("reasoning"),
  toolCallId: text("tool_call_id"),
  toolName: text("tool_name"),
  toolArgs: text("tool_args", { mode: "json" }),
  toolCalls: text("tool_calls", { mode: "json" }),
  sessionId: integer("session_id").references(() => workSessions.id, {
    onDelete: "set null",
  }),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  costUsd: real("cost_usd"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const toolExecutions = sqliteTable("tool_executions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  messageId: integer("message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  tool: text("tool").notNull(),
  input: text("input", { mode: "json" }),
  summary: text("summary"),
  output: text("output"),
  status: text("status", {
    enum: ["success", "error", "awaiting_approval", "approved", "denied", "blocked", "rate_limited", "cancelled"],
  })
    .notNull()
    .default("success"),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high", "critical", "blocked"] })
    .notNull()
    .default("low"),
  riskReason: text("risk_reason"),
  requestedAt: integer("requested_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  resolvedBy: text("resolved_by"),
  durationMs: integer("duration_ms"),
  // The villager this belongs to (#56).
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
});

export const journalEntries = sqliteTable("journal_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body"),
  category: text("category", {
    enum: ["exploration", "task", "reflection", "idea", "system"],
  })
    .notNull()
    .default("task"),
  status: text("status", { enum: ["open", "in_progress", "done", "abandoned"] })
    .notNull()
    .default("open"),
  // The villager this belongs to (#56).
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body"),
  status: text("status", { enum: ["backlog", "in_progress", "done", "abandoned"] })
    .notNull()
    .default("backlog"),
  priority: integer("priority").notNull().default(3),
  conversationId: integer("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  // Whose goal; empty = a town goal anyone may pick up (#56).
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull().default("info"),
  title: text("title").notNull(),
  body: text("body"),
  severity: text("severity", { enum: ["info", "success", "warning", "critical"] })
    .notNull()
    .default("info"),
  source: text("source").notNull().default("system"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  // Which villager sent it, if any.
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const agentSettings = sqliteTable("agent_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  autonomyMode: text("autonomy_mode", { enum: ["manual", "balanced", "autonomous", "unrestricted"] })
    .notNull()
    .default("manual"),
  modelName: text("model_name").notNull().default("deepseek-v4-flash"),
  maxAgentSteps: integer("max_agent_steps").notNull().default(16),
  maxActionsPerHour: integer("max_actions_per_hour").notNull().default(120),
  commandTimeoutSec: integer("command_timeout_sec").notNull().default(30),
  toolRetries: integer("tool_retries").notNull().default(1),
  workspaceDir: text("workspace_dir").notNull().default("/root/agent-workspace"),
  enabledTools: text("enabled_tools", { mode: "json" })
    .notNull()
    .default(
      sql`('["run_shell_command","read_file","write_file","list_directory","delete_path","get_system_status","list_processes","manage_package","manage_service","fetch_url","update_journal","schedule_job","list_jobs","cancel_job","manage_goal","list_goals","notify_human","post_message","query_database","download_file","edit_file","take_screenshot"]')`,
    ),
  extraProtectedPaths: text("extra_protected_paths", { mode: "json" }).notNull().default(sql`('[]')`),
  systemPromptExtra: text("system_prompt_extra"),
  staticCorePrompt: text("static_core_prompt"),
  // The agent's personality, in the owner's words. Empty = the default.
  persona: text("persona"),
  workWindowPrompt: text("work_window_prompt"),
  focusedChatPrompt: text("focused_chat_prompt"),
  truncationMessage: text("truncation_message"),
  allowNetworkFetch: integer("allow_network_fetch", { mode: "boolean" }).notNull().default(true),
  agentName: text("agent_name").notNull().default("Root"),
  apiKey: text("api_key"),
  apiBaseUrl: text("api_base_url").notNull().default("https://api.deepseek.com"),
  deepseekModels: text("deepseek_models", { mode: "json" }).notNull().default(sql`('[]')`),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  humanAtKeyboard: integer("human_at_keyboard", { mode: "boolean" }).notNull().default(false),
  chatMode: text("chat_mode", { enum: ["agentic", "conversation"] }).notNull().default("agentic"),
  minGapMinutes: integer("min_gap_minutes").notNull().default(10),
  maxSessionsPerDay: integer("max_sessions_per_day").notNull().default(24),
  maxSessionMinutes: integer("max_session_minutes").notNull().default(10),
  inputPricePerMTok: real("input_price_per_mtok").notNull().default(0.14),
  outputPricePerMTok: real("output_price_per_mtok").notNull().default(0.28),
  unrestrictedMode: integer("unrestricted_mode", { mode: "boolean" }).notNull().default(false),
  allowSecretReads: integer("allow_secret_reads", { mode: "boolean" }).notNull().default(false),
  allowFrameworkMutations: integer("allow_framework_mutations", { mode: "boolean" }).notNull().default(false),
  allowDestructiveShell: integer("allow_destructive_shell", { mode: "boolean" }).notNull().default(false),
  allowProtectedSystemOps: integer("allow_protected_system_ops", { mode: "boolean" }).notNull().default(false),
  maxContextTokens: integer("max_context_tokens").notNull().default(24000),
  compactTargetTokens: integer("compact_target_tokens").notNull().default(9000),
  autoCompact: integer("auto_compact", { mode: "boolean" }).notNull().default(true),
  thinkingEnabled: integer("thinking_enabled", { mode: "boolean" }).notNull().default(true),
  reasoningEffort: text("reasoning_effort").notNull().default("low"),
  maxOutputTokens: integer("max_output_tokens").notNull().default(2048),
  cacheHitInputPricePerMTok: real("cache_hit_input_price_per_mtok").notNull().default(0.0028),
  // What the whole town may spend per day, in USD; empty = no town cap (#60).
  townDailyBudgetUsd: real("town_daily_budget_usd"),
  // Day and night (#100): local "HH:MM". At night no autonomous work starts.
  bedtime: text("bedtime").notNull().default("22:00"),
  // New tools already offered to this install (see settingsStore), so a tool
  // the owner switched off isn't switched back on.
  offeredTools: text("offered_tools", { mode: "json" }),
  wakeTime: text("wake_time").notNull().default("07:00"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
