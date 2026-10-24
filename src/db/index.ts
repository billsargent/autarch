import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { DB_PATH } from "./path";
import { DEFAULT_ENABLED_TOOLS } from "../lib/agent/config";

// Self-contained SQLite database — no environment variables required.
// The DB file and tables are created automatically on first run.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'New session',
  summary TEXT,
  compacted_through_id INTEGER,
  chat_mode TEXT NOT NULL DEFAULT 'agentic',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'interval',
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  max_duration_minutes INTEGER NOT NULL DEFAULT 10,
  report_session_title TEXT,
  cron TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_run_at INTEGER,
  last_status TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Villager',
  persona TEXT,
  character TEXT NOT NULL DEFAULT 'villager',
  color TEXT NOT NULL DEFAULT '#4f86c6',
  model TEXT,
  enabled_tools TEXT,
  home TEXT NOT NULL DEFAULT '',
  is_mayor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  daily_budget_usd REAL,
  max_actions_per_hour INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS work_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at INTEGER,
  steps_used INTEGER NOT NULL DEFAULT 0,
  actions_used INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
  cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  reason TEXT,
  heartbeat_at INTEGER,
  cancel_requested INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT,
  reasoning TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  tool_args TEXT,
  tool_calls TEXT,
  session_id INTEGER REFERENCES work_sessions(id) ON DELETE SET NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS tool_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  tool TEXT NOT NULL,
  input TEXT,
  summary TEXT,
  output TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  risk_level TEXT NOT NULL DEFAULT 'low',
  risk_reason TEXT,
  requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  resolved_by TEXT,
  duration_ms INTEGER
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  category TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  priority INTEGER NOT NULL DEFAULT 3,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL DEFAULT 'system',
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS agent_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  autonomy_mode TEXT NOT NULL DEFAULT 'manual',
  model_name TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
  max_agent_steps INTEGER NOT NULL DEFAULT 16,
  max_actions_per_hour INTEGER NOT NULL DEFAULT 120,
  command_timeout_sec INTEGER NOT NULL DEFAULT 30,
  tool_retries INTEGER NOT NULL DEFAULT 1,
  workspace_dir TEXT NOT NULL DEFAULT '/root/agent-workspace',
  enabled_tools TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_ENABLED_TOOLS)}',
  extra_protected_paths TEXT NOT NULL DEFAULT '[]',
  system_prompt_extra TEXT,
  static_core_prompt TEXT,
  persona TEXT,
  work_window_prompt TEXT,
  focused_chat_prompt TEXT,
  truncation_message TEXT,
  allow_network_fetch INTEGER NOT NULL DEFAULT 1,
  agent_name TEXT NOT NULL DEFAULT 'Root',
  api_key TEXT,
  api_base_url TEXT NOT NULL DEFAULT 'https://api.deepseek.com',
  deepseek_models TEXT NOT NULL DEFAULT '[]',
  paused INTEGER NOT NULL DEFAULT 0,
  human_at_keyboard INTEGER NOT NULL DEFAULT 0,
  chat_mode TEXT NOT NULL DEFAULT 'agentic',
  min_gap_minutes INTEGER NOT NULL DEFAULT 10,
  max_sessions_per_day INTEGER NOT NULL DEFAULT 24,
  max_session_minutes INTEGER NOT NULL DEFAULT 10,
  input_price_per_mtok REAL NOT NULL DEFAULT 0.14,
  output_price_per_mtok REAL NOT NULL DEFAULT 0.28,
  unrestricted_mode INTEGER NOT NULL DEFAULT 0,
  allow_secret_reads INTEGER NOT NULL DEFAULT 0,
  allow_framework_mutations INTEGER NOT NULL DEFAULT 0,
  allow_destructive_shell INTEGER NOT NULL DEFAULT 0,
  allow_protected_system_ops INTEGER NOT NULL DEFAULT 0,
  max_context_tokens INTEGER NOT NULL DEFAULT 24000,
  compact_target_tokens INTEGER NOT NULL DEFAULT 9000,
  auto_compact INTEGER NOT NULL DEFAULT 1,
  thinking_enabled INTEGER NOT NULL DEFAULT 1,
  reasoning_effort TEXT NOT NULL DEFAULT 'low',
  max_output_tokens INTEGER NOT NULL DEFAULT 2048,
  cache_hit_input_price_per_mtok REAL NOT NULL DEFAULT 0.0028,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

const globalForDb = globalThis as typeof globalThis & {
  __agentLabSqlite?: Database.Database;
};

const sqlite = globalForDb.__agentLabSqlite ?? new Database(DB_PATH);

if (!globalForDb.__agentLabSqlite) {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
}

// The schema and its upgrades run every time this module loads, not just when
// the connection opens: a dev server keeps its connection across hot reloads,
// and would otherwise miss columns added by new code. Each check is a quick
// lookup.
{
  sqlite.exec(SCHEMA_SQL);

  // Migrate pre-existing DBs that were created before these columns existed
  // (CREATE TABLE IF NOT EXISTS won't add columns to an existing table).
  const existingCols = (table: string) =>
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!existingCols("jobs").includes("cron")) {
    sqlite.exec("ALTER TABLE jobs ADD COLUMN cron TEXT");
  }
  if (!existingCols("agent_settings").includes("human_at_keyboard")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN human_at_keyboard INTEGER NOT NULL DEFAULT 0");
  }
  if (!existingCols("agent_settings").includes("chat_mode")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'agentic'");
  }
  if (!existingCols("agent_settings").includes("tool_retries")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN tool_retries INTEGER NOT NULL DEFAULT 1");
  }
  if (!existingCols("conversations").includes("summary")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN summary TEXT");
    sqlite.exec("ALTER TABLE conversations ADD COLUMN compacted_through_id INTEGER");
  }
  if (!existingCols("agent_settings").includes("max_context_tokens")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN max_context_tokens INTEGER NOT NULL DEFAULT 24000");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN compact_target_tokens INTEGER NOT NULL DEFAULT 9000");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN auto_compact INTEGER NOT NULL DEFAULT 1");
  }
  if (!existingCols("agent_settings").includes("thinking_enabled")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN thinking_enabled INTEGER NOT NULL DEFAULT 1");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'low'");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 2048");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN cache_hit_input_price_per_mtok REAL NOT NULL DEFAULT 0.0028");
  }
  if (!existingCols("work_sessions").includes("cache_hit_tokens")) {
    sqlite.exec("ALTER TABLE work_sessions ADD COLUMN cache_hit_tokens INTEGER NOT NULL DEFAULT 0");
    sqlite.exec("ALTER TABLE work_sessions ADD COLUMN cache_miss_tokens INTEGER NOT NULL DEFAULT 0");
  }
  if (!existingCols("goals").includes("conversation_id")) {
    sqlite.exec("ALTER TABLE goals ADD COLUMN conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL");
  }
  if (!existingCols("jobs").includes("report_session_title")) {
    sqlite.exec("ALTER TABLE jobs ADD COLUMN report_session_title TEXT");
  }
  if (!existingCols("agent_settings").includes("persona")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN persona TEXT");
  }
  if (!existingCols("agent_settings").includes("static_core_prompt")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN static_core_prompt TEXT");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN work_window_prompt TEXT");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN focused_chat_prompt TEXT");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN truncation_message TEXT");
  }
  // Chat mode moved from a global setting to each conversation. Backfill from
  // the old global value so no existing conversation silently changes mode.
  if (!existingCols("conversations").includes("chat_mode")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'agentic'");
    sqlite.exec(
      "UPDATE conversations SET chat_mode = COALESCE((SELECT chat_mode FROM agent_settings ORDER BY id LIMIT 1), 'agentic')",
    );
  }
  // One turn per conversation, and Stop across processes (#18, #19).
  if (!existingCols("work_sessions").includes("heartbeat_at")) {
    sqlite.exec("ALTER TABLE work_sessions ADD COLUMN heartbeat_at INTEGER");
    sqlite.exec("ALTER TABLE work_sessions ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0");
  }
  // Villagers (#55, #56): everything gets an owner. The Mayor is created, and
  // existing rows given to him, by ensureMayor() (src/lib/agent/agents.ts).
  for (const table of ["conversations", "jobs", "work_sessions", "tool_executions", "journal_entries", "goals", "notifications"]) {
    if (!existingCols(table).includes("agent_id")) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL`);
    }
  }
  if (!existingCols("agents").includes("paused_by")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN paused_by TEXT");
  }
  // Ranks and hiring (#99).
  if (!existingCols("agents").includes("tier")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN tier TEXT NOT NULL DEFAULT 'director'");
    sqlite.exec("ALTER TABLE agents ADD COLUMN area TEXT");
    sqlite.exec("ALTER TABLE agents ADD COLUMN manager_id INTEGER");
  }
  sqlite.exec("UPDATE agents SET tier = 'mayor' WHERE is_mayor = 1 AND tier <> 'mayor'");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS hire_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposed_by INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    draft TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'interviewing',
    interview TEXT,
    verdict TEXT,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    decided_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    decided_at INTEGER
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT,
    called_by TEXT NOT NULL DEFAULT 'owner',
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    participants TEXT NOT NULL,
    threads TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    speaking_agent_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    ended_at INTEGER
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    base_url TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS provider_keys (
    provider_id INTEGER PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
    api_key TEXT NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS model_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL,
    input_per_mtok REAL NOT NULL,
    output_per_mtok REAL NOT NULL,
    cache_hit_per_mtok REAL
  )`);
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_model_prices ON model_prices(provider_id, model)");
  if (!existingCols("agents").includes("provider_id")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN provider_id INTEGER");
  }
  if (!existingCols("conversations").includes("provider_id")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN provider_id INTEGER");
    sqlite.exec("ALTER TABLE conversations ADD COLUMN model TEXT");
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'other',
    target TEXT,
    subject TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    send_result TEXT,
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    decided_at INTEGER
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS economy (
    id INTEGER PRIMARY KEY,
    wheat INTEGER NOT NULL DEFAULT 0,
    bread INTEGER NOT NULL DEFAULT 6,
    shortage INTEGER NOT NULL DEFAULT 0,
    last_tick_day TEXT
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    plot_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed',
    proposed_by INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    ready_at INTEGER,
    keeper_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    proposed_by INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open',
    rounds INTEGER NOT NULL DEFAULT 0,
    last_vote_at INTEGER,
    goal_id INTEGER,
    decided_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    decided_at INTEGER
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    choice TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  if (!existingCols("agent_settings").includes("calendar_ics_url")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN calendar_ics_url TEXT");
  }
  if (!existingCols("agent_settings").includes("vote_cost_cap_usd")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN vote_cost_cap_usd REAL NOT NULL DEFAULT 0.15");
  }
  if (!existingCols("goals").includes("notes")) {
    sqlite.exec("ALTER TABLE goals ADD COLUMN notes TEXT");
  }
  // One messaging tool (#70): lists naming the old two name the new one.
  for (const [table, col] of [["agents", "enabled_tools"], ["agent_settings", "enabled_tools"]] as const) {
    const rows = sqlite.prepare(`SELECT id, ${col} AS tools FROM ${table} WHERE ${col} LIKE '%notify_human%' OR ${col} LIKE '%post_message%'`).all() as Array<{ id: number; tools: string }>;
    for (const r of rows) {
      let list: string[] = [];
      try {
        list = JSON.parse(r.tools);
      } catch {
        continue;
      }
      const next = [...new Set(list.map((t) => (t === "notify_human" || t === "post_message" ? "message_owner" : t)))];
      sqlite.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).run(JSON.stringify(next), r.id);
    }
  }
  if (!existingCols("work_sessions").includes("model")) {
    sqlite.exec("ALTER TABLE work_sessions ADD COLUMN model TEXT");
  }
  if (!existingCols("journal_entries").includes("subject_agent_id")) {
    sqlite.exec("ALTER TABLE journal_entries ADD COLUMN subject_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL");
  }
  if (!existingCols("agent_settings").includes("away_until")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN away_until INTEGER");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN away_started_at INTEGER");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN away_spend_cap_usd REAL NOT NULL DEFAULT 1");
  }
  if (!existingCols("meetings").includes("summary")) {
    sqlite.exec("ALTER TABLE meetings ADD COLUMN summary TEXT");
  }
  if (!existingCols("agent_settings").includes("meeting_cost_cap_usd")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN meeting_cost_cap_usd REAL NOT NULL DEFAULT 0.25");
  }
  if (!existingCols("agent_settings").includes("hiring_mode")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN hiring_mode TEXT NOT NULL DEFAULT 'ask'");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN max_population INTEGER NOT NULL DEFAULT 8");
  }
  if (!existingCols("conversations").includes("partner_agent_id")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN partner_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL");
  }
  if (!existingCols("agent_settings").includes("offered_tools")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN offered_tools TEXT");
  }
  if (!existingCols("agent_settings").includes("bedtime")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN bedtime TEXT NOT NULL DEFAULT '22:00'");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN wake_time TEXT NOT NULL DEFAULT '07:00'");
  }
  if (!existingCols("agent_settings").includes("town_daily_budget_usd")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN town_daily_budget_usd REAL");
  }
  // The live event log (#74): triggers record every change pages show,
  // whichever process makes it; /api/events streams new rows to browsers.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    ref INTEGER,
    conversation_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  for (const [table, kind, conv, ops] of [
    ["messages", "message", "NEW.conversation_id", ["INSERT", "UPDATE"]],
    ["conversations", "conversation", "NEW.id", ["INSERT", "UPDATE"]],
    ["work_sessions", "session", "NEW.conversation_id", ["INSERT", "UPDATE OF status"]],
    ["tool_executions", "tool", "NEW.conversation_id", ["INSERT", "UPDATE OF status"]],
    ["notifications", "notification", "NULL", ["INSERT", "UPDATE"]],
    ["agent_settings", "settings", "NULL", ["UPDATE"]],
    ["jobs", "job", "NEW.conversation_id", ["INSERT", "UPDATE"]],
    ["goals", "goal", "NEW.conversation_id", ["INSERT", "UPDATE"]],
    ["journal_entries", "journal", "NULL", ["INSERT", "UPDATE"]],
    ["agents", "agent", "NULL", ["INSERT", "UPDATE"]],
    ["hire_requests", "hire", "NULL", ["INSERT", "UPDATE"]],
    ["meetings", "meeting", "NEW.conversation_id", ["INSERT", "UPDATE"]],
    ["ideas", "idea", "NULL", ["INSERT", "UPDATE"]],
    ["votes", "idea", "NULL", ["INSERT"]],
    ["buildings", "building", "NULL", ["INSERT", "UPDATE"]],
    ["economy", "building", "NULL", ["UPDATE"]],
    ["drafts", "draft", "NULL", ["INSERT", "UPDATE"]],
  ] as const) {
    for (const op of ops) {
      const name = `ev_${table}_${op.split(" ")[0].toLowerCase()}`;
      sqlite.exec(`CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${op} ON ${table} BEGIN INSERT INTO events (kind, ref, conversation_id) VALUES ('${kind}', NEW.id, ${conv}); END`);
    }
  }
  // Deletions matter for lists too.
  for (const [table, kind] of [["conversations", "conversation"], ["jobs", "job"], ["goals", "goal"], ["journal_entries", "journal"], ["notifications", "notification"]] as const) {
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS ev_${table}_delete AFTER DELETE ON ${table} BEGIN INSERT INTO events (kind, ref) VALUES ('${kind}', OLD.id); END`);
  }

  // Indexes for the hot queries (#33).
  for (const [name, on] of [
    ["idx_messages_conversation", "messages(conversation_id, id)"],
    ["idx_tool_exec_status", "tool_executions(status)"],
    ["idx_tool_exec_conversation", "tool_executions(conversation_id)"],
    ["idx_tool_exec_agent_requested", "tool_executions(agent_id, requested_at)"],
    ["idx_sessions_status", "work_sessions(status)"],
    ["idx_sessions_started", "work_sessions(started_at)"],
    ["idx_sessions_agent_started", "work_sessions(agent_id, started_at)"],
    ["idx_sessions_conversation", "work_sessions(conversation_id)"],
    ["idx_sessions_job", "work_sessions(job_id)"],
    ["idx_jobs_due", "jobs(enabled, next_run_at)"],
    ["idx_notifications_read", "notifications(read)"],
    ["idx_conversations_agent", "conversations(agent_id)"],
    ["idx_journal_agent", "journal_entries(agent_id)"],
  ] as const) {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${on}`);
  }
  // Clean up stale FK references (conversations deleted without cascade).
  sqlite.exec("UPDATE jobs SET conversation_id = NULL WHERE conversation_id IS NOT NULL AND conversation_id NOT IN (SELECT id FROM conversations)");

  globalForDb.__agentLabSqlite = sqlite;
}

export const db = drizzle(sqlite);
export { sqlite };
