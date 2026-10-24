import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { DB_PATH } from "./path";

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
  enabled_tools TEXT NOT NULL DEFAULT '["run_shell_command","read_file","write_file","list_directory","delete_path","get_system_status","list_processes","manage_package","manage_service","fetch_url","update_journal","schedule_job","list_jobs","cancel_job","manage_goal","list_goals","notify_human","query_database","download_file","edit_file","take_screenshot"]',
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
  if (!existingCols("agent_settings").includes("away_until")) {
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN away_until INTEGER");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN away_started_at INTEGER");
    sqlite.exec("ALTER TABLE agent_settings ADD COLUMN away_spend_cap_usd REAL NOT NULL DEFAULT 1");
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
  // Clean up stale FK references (conversations deleted without cascade).
  sqlite.exec("UPDATE jobs SET conversation_id = NULL WHERE conversation_id IS NOT NULL AND conversation_id NOT IN (SELECT id FROM conversations)");

  globalForDb.__agentLabSqlite = sqlite;
}

export const db = drizzle(sqlite);
export { sqlite };
