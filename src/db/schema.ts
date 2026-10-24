import {
  sqliteTable,
  integer,
  text,
  real,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { DEFAULT_ENABLED_TOOLS } from "../lib/agent/config";
import { SESSION_TRIGGERS } from "../lib/agent/triggers";

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
  // Who paused them (#58): the Mayor may only let villagers he paused work again.
  pausedBy: text("paused_by", { enum: ["owner", "mayor"] }),
  // The village's ranks (#99): the Mayor, directors who run an area (and may
  // draft hires), and workers who report to a director.
  tier: text("tier", { enum: ["mayor", "director", "worker"] }).notNull().default("director"),
  // Their provider (#64); empty = the town's.
  providerId: integer("provider_id"),
  area: text("area"),
  managerId: integer("manager_id"),
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
  // This conversation's own provider and model, over its villager's (#64).
  providerId: integer("provider_id"),
  model: text("model"),
  // The villager this belongs to (#56).
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  instruction: text("instruction").notNull().default(""),
  // "daydream": a villager's free time (#59).
  kind: text("kind", { enum: ["interval", "daily_report", "self_work", "daydream"] }).notNull().default("interval"),
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
  trigger: text("trigger", { enum: SESSION_TRIGGERS }).notNull(),
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
  // The model the turn ran on (#80), for spending per model.
  model: text("model"),
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
    enum: ["exploration", "task", "reflection", "idea", "system", "neighbour"],
  })
    .notNull()
    .default("task"),
  status: text("status", { enum: ["open", "in_progress", "done", "abandoned"] })
    .notNull()
    .default("open"),
  // The villager this belongs to (#56).
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  // A note about a neighbour (#103): who it's about.
  subjectAgentId: integer("subject_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// Hire requests (#99): a draft villager proposed by the Mayor or a director,
// interviewed by the Mayor, then hired by the owner (or straight away when the
// owner lets the Mayor hire within caps).
export const hireRequests = sqliteTable("hire_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Who drafted it; empty = the owner.
  proposedBy: integer("proposed_by").references(() => agents.id, { onDelete: "set null" }),
  // The fields of the new villager, as POST /api/agents takes them.
  draft: text("draft", { mode: "json" }).notNull(),
  reason: text("reason"),
  status: text("status", { enum: ["interviewing", "awaiting_owner", "hired", "declined"] }).notNull().default("interviewing"),
  // The Mayor's interview: what he said, and his verdict.
  interview: text("interview"),
  verdict: text("verdict", { enum: ["recommend", "reject", "unsure"] }),
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  // The villager it became.
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  decidedBy: text("decided_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
});

// Ideas and votes (#98, docs/town-charter.md section 5). Anyone proposes; the
// active villagers vote; a majority with quorum adopts it as a town goal; the
// owner can veto at any time.
export const ideas = sqliteTable("ideas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body"),
  // Who proposed it; empty = the owner.
  proposedBy: integer("proposed_by").references(() => agents.id, { onDelete: "set null" }),
  status: text("status", { enum: ["open", "voting", "adopted", "rejected", "vetoed"] }).notNull().default("open"),
  rounds: integer("rounds").notNull().default(0),
  lastVoteAt: integer("last_vote_at", { mode: "timestamp" }),
  goalId: integer("goal_id"),
  decidedBy: text("decided_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
});

export const votes = sqliteTable("votes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ideaId: integer("idea_id").notNull().references(() => ideas.id, { onDelete: "cascade" }),
  round: integer("round").notNull(),
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  choice: text("choice", { enum: ["yes", "no", "abstain"] }).notNull(),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// Buildings on the village's plots (#105) and who keeps them (#106).
export const buildings = sqliteTable("buildings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["house", "farm", "bakery", "workshop"] }).notNull(),
  plotId: text("plot_id").notNull(),
  status: text("status", { enum: ["proposed", "building", "built", "declined"] }).notNull().default("proposed"),
  // Who proposed it; empty = the owner.
  proposedBy: integer("proposed_by").references(() => agents.id, { onDelete: "set null" }),
  readyAt: integer("ready_at", { mode: "timestamp" }),
  keeperId: integer("keeper_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// Model providers beyond the town's own (#61): keys in their own table, which
// no API returns; prices per provider and model (0 = the town's provider).
export const providers = sqliteTable("providers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["deepseek", "openai", "anthropic"] }).notNull(),
  baseUrl: text("base_url").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const providerKeys = sqliteTable("provider_keys", {
  providerId: integer("provider_id").primaryKey().references(() => providers.id, { onDelete: "cascade" }),
  apiKey: text("api_key").notNull(),
});

export const modelPrices = sqliteTable("model_prices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerId: integer("provider_id").notNull().default(0),
  model: text("model").notNull(),
  inputPerMTok: real("input_per_mtok").notNull(),
  outputPerMTok: real("output_per_mtok").notNull(),
  cacheHitPerMTok: real("cache_hit_per_mtok"),
});

// The outbox (#107): outward-facing work waits here for the owner.
export const drafts = sqliteTable("drafts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["email", "post", "listing", "message", "other"] }).notNull().default("other"),
  // Who or where it's for (an address, a channel, a shop).
  target: text("target"),
  subject: text("subject"),
  content: text("content").notNull(),
  status: text("status", { enum: ["draft", "approved", "sent", "discarded", "failed"] }).notNull().default("draft"),
  sendResult: text("send_result"),
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
});

// The village's stores (#106): one row, updated once a day.
export const economy = sqliteTable("economy", {
  id: integer("id").primaryKey(),
  wheat: integer("wheat").notNull().default(0),
  bread: integer("bread").notNull().default(6),
  // Loaves short at the last day's meals.
  shortage: integer("shortage").notNull().default(0),
  lastTickDay: text("last_tick_day"),
});

// Town meetings (#81): the owner (or the Mayor) asks, and each villager at
// the meeting answers in turn. The transcript is a conversation of the
// Mayor's; each villager also has a thread of their own for the meeting,
// where they hear what was said and answer (`threads`: agent id -> its
// conversation and the last transcript message it has heard).
export const meetings = sqliteTable("meetings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topic: text("topic"),
  calledBy: text("called_by").notNull().default("owner"),
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  participants: text("participants", { mode: "json" }).notNull(),
  threads: text("threads", { mode: "json" }),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  // Who is answering right now, while a round runs.
  speakingAgentId: integer("speaking_agent_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  endedAt: integer("ended_at", { mode: "timestamp" }),
});

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body"),
  status: text("status", { enum: ["backlog", "in_progress", "done", "abandoned"] })
    .notNull()
    .default("backlog"),
  priority: integer("priority").notNull().default(3),
  // Where the work stands (#68): the villager reads and updates these instead
  // of a free-form notes/plan.md.
  notes: text("notes"),
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
  // One list of default tools, config.ts (#34).
  enabledTools: text("enabled_tools", { mode: "json" })
    .notNull()
    .$defaultFn(() => DEFAULT_ENABLED_TOOLS),
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
  // Hiring (#99): "ask" = every hire waits for the owner; "auto" = the Mayor
  // hires within the caps. And how many villagers the village can hold.
  hiringMode: text("hiring_mode", { enum: ["ask", "auto"] }).notNull().default("ask"),
  maxPopulation: integer("max_population").notNull().default(8),
  // What one town meeting may spend in all, in USD (#81).
  meetingCostCapUsd: real("meeting_cost_cap_usd").notNull().default(0.25),
  // Away mode (#102): while the owner is away (until awayUntil), the Mayor
  // may approve low- and medium-risk requests, until the village has spent
  // awaySpendCapUsd since awayStartedAt.
  awayUntil: integer("away_until", { mode: "timestamp" }),
  awayStartedAt: integer("away_started_at", { mode: "timestamp" }),
  awaySpendCapUsd: real("away_spend_cap_usd").notNull().default(1),
  // What one round of votes may spend in all, in USD (#98).
  voteCostCapUsd: real("vote_cost_cap_usd").notNull().default(0.15),
  // The owner's calendar (#108): its private ICS address. A secret: never
  // shown to agents, and query_database can't read it.
  calendarIcsUrl: text("calendar_ics_url"),
  // New tools already offered to this install (see settingsStore), so a tool
  // the owner switched off isn't switched back on.
  offeredTools: text("offered_tools", { mode: "json" }),
  wakeTime: text("wake_time").notNull().default("07:00"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
