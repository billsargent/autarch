// Hard-coded safety configuration for the agent runtime.
// These constants are intentionally NOT exposed as editable settings because
// they protect the app's own runtime (Next.js, SQLite, Drizzle, node_modules)
// from being damaged by the agent. Users can add *extra* protected paths via
// settings, but these core protections can never be removed from the UI.

import os from "node:os";
import path from "node:path";
import { AUTH_FILE, DB_FILES } from "../../db/path";

export const PROJECT_ROOT = /*turbopackIgnore: true*/ process.cwd();

// Paths (relative to project root or absolute) that can never be written to,
// deleted, or moved — no approval can override these. This is what keeps the
// agent from destroying the very app that is running it.
export const HARD_PROTECTED_PATHS: string[] = [
  path.join(PROJECT_ROOT, "node_modules"),
  path.join(PROJECT_ROOT, ".git"),
  path.join(PROJECT_ROOT, ".next"),
  path.join(PROJECT_ROOT, "package.json"),
  path.join(PROJECT_ROOT, "package-lock.json"),
  path.join(PROJECT_ROOT, "pnpm-lock.yaml"),
  path.join(PROJECT_ROOT, "yarn.lock"),
  path.join(PROJECT_ROOT, "drizzle.config.json"),
  path.join(PROJECT_ROOT, "drizzle.config.ts"),
  path.join(PROJECT_ROOT, "tsconfig.json"),
  path.join(PROJECT_ROOT, "next.config.ts"),
  path.join(PROJECT_ROOT, "next.config.js"),
  // The framework's own code, including these guardrails, plus its scripts,
  // deploy units and static art. An agent that could edit risk.ts could
  // switch its own guardrails off (#12).
  path.join(PROJECT_ROOT, "src"),
  path.join(PROJECT_ROOT, "scripts"),
  path.join(PROJECT_ROOT, "deploy"),
  path.join(PROJECT_ROOT, "public"),
  path.join(PROJECT_ROOT, ".env"),
  path.join(PROJECT_ROOT, ".env.local"),
  path.join(PROJECT_ROOT, ".env.production"),
  // The framework's own SQLite database must never be modified/deleted by the agent.
  path.join(PROJECT_ROOT, "data", "app.db"),
  path.join(PROJECT_ROOT, "data", "app.db-wal"),
  path.join(PROJECT_ROOT, "data", "app.db-shm"),
  // ...and wherever AUTARCH_DB_PATH points it.
  ...DB_FILES,
  AUTH_FILE,
];

// Any path (anywhere on disk) matching these patterns is treated as a secret
// and can never be *read* through the agent's file tools (exfiltration guard).
export const SECRET_PATH_PATTERNS: RegExp[] = [
  /\.env(\..*)?$/i,
  /\.ssh\//i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
  /shadow$/i,
  /gshadow$/i,
  /\.aws\/credentials/i,
  /credentials\.json$/i,
  /\.npmrc$/i,
  // The framework's own database holds the plaintext DeepSeek API key,
  // including a custom AUTARCH_DB_PATH location.
  /app\.db(-wal|-shm)?$/i,
  ...[...DB_FILES, AUTH_FILE].map((f) => new RegExp(`^${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")),
];

// System directories that require CRITICAL (always human-approved) risk for
// any write / delete operation.
export const SYSTEM_SENSITIVE_DIRS: string[] = [
  "/etc",
  "/boot",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/var",
  "/root",
  "/sys",
  "/proc",
];

// apt/dpkg packages that must never be removed — doing so would break the
// machine's ability to run this very framework (Node runtime, SQLite, core
// OS tooling). apt-get remove/purge on any of these is fully BLOCKED.
export const PROTECTED_PACKAGES: string[] = [
  "nodejs",
  "npm",
  "node",
  "libsqlite3-0",
  "sudo",
  "systemd",
  "systemd-sysv",
  "bash",
  "coreutils",
  "dpkg",
  "apt",
  "apt-utils",
  "libc6",
  "libc-bin",
  "python3",
  "python3-minimal",
  "init",
  "login",
  "passwd",
  "e2fsprogs",
  "util-linux",
];

// systemd services that can never be stopped/disabled/masked through the
// agent because the box depends on
// them to stay reachable/bootable.
export const PROTECTED_SERVICES: string[] = [
  "systemd-journald",
  "systemd-logind",
  "dbus",
  "cron",
  "ssh",
  "sshd",
  "networking",
  "systemd-networkd",
  "systemd-resolved",
];

// Process names that can never be targeted by kill/pkill/killall — this is
// what stops the agent from suicide-killing the Node server or the database.
export const PROTECTED_PROCESS_NAMES: string[] = [
  "node",
  "next-server",
  "npm",
];

// In the home folder of the user the server runs as (/root/agent-workspace
// when that's root), so it's always writable. Persistent — /tmp is wiped on
// reboot; installs from before that are auto-migrated by
// settingsStore.getSettings(). Existing installs keep their setting.
export const DEFAULT_WORKSPACE_DIR = path.join(os.homedir(), "agent-workspace");

// The agent's reusable markdown playbooks live INSIDE the workspace so the agent
// can write them at low risk and everything agent-facing stays in one place.
export function workspaceSkillsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "skills");
}

export const DEFAULT_ENABLED_TOOLS = [
  "run_shell_command",
  "read_file",
  "write_file",
  "list_directory",
  "delete_path",
  "get_system_status",
  "list_processes",
  "manage_package",
  "manage_service",
  "fetch_url",
  "update_journal",
  "schedule_job",
  "list_jobs",
  "cancel_job",
  "manage_goal",
  "list_goals",
  "message_owner",
  "query_database",
  "download_file",
  "edit_file",
  "take_screenshot",
  "web_search",
  "ask_villager",
  // The Mayor's (#58); only he ever gets them.
  "assign_goal",
  "schedule_job_for",
  "review_agent",
  "flag",
  "pause_agent",
  "resume_agent",
  "call_meeting",
  "call_vote",
  "propose_building",
  // Ideas (#98): anyone may propose.
  "propose_idea",
  "pin_notice",
  // The outbox (#107).
  "save_draft",
  "note_about",
  // Hiring (#99): the Mayor and directors.
  "propose_hire",
];

export const MAX_OUTPUT_CHARS = 8000;
export const MAX_FETCH_BYTES = 200_000;
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
