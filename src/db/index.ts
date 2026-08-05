import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// Self-contained SQLite database — no environment variables required.
// The DB file and tables are created automatically on first run.
const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "app.db");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'New session',
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
  cron TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_run_at INTEGER,
  last_status TEXT,
  last_error TEXT,
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
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  reason TEXT
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
  model_name TEXT NOT NULL DEFAULT 'deepseek-chat',
  max_agent_steps INTEGER NOT NULL DEFAULT 16,
  max_actions_per_hour INTEGER NOT NULL DEFAULT 120,
  command_timeout_sec INTEGER NOT NULL DEFAULT 30,
  tool_retries INTEGER NOT NULL DEFAULT 1,
  workspace_dir TEXT NOT NULL DEFAULT '/root/agent-workspace',
  enabled_tools TEXT NOT NULL DEFAULT '["run_shell_command","read_file","write_file","list_directory","delete_path","get_system_status","list_processes","manage_package","manage_service","fetch_url","update_journal","schedule_job","list_jobs","cancel_job","manage_goal","list_goals","notify_human","query_database","download_file","edit_file","take_screenshot"]',
  extra_protected_paths TEXT NOT NULL DEFAULT '[]',
  system_prompt_extra TEXT,
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
  input_price_per_mtok REAL NOT NULL DEFAULT 0.27,
  output_price_per_mtok REAL NOT NULL DEFAULT 1.1,
  unrestricted_mode INTEGER NOT NULL DEFAULT 0,
  allow_secret_reads INTEGER NOT NULL DEFAULT 0,
  allow_framework_mutations INTEGER NOT NULL DEFAULT 0,
  allow_destructive_shell INTEGER NOT NULL DEFAULT 0,
  allow_protected_system_ops INTEGER NOT NULL DEFAULT 0,
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

  globalForDb.__agentLabSqlite = sqlite;
}

export const db = drizzle(sqlite);
export { sqlite };
