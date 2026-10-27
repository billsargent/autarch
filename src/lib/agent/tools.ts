import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import fssync from "node:fs";
import dns from "node:dns/promises";
import os from "node:os";
import path from "node:path";
import type { AgentSettingsRow } from "./settingsStore";
import Database from "better-sqlite3";
import { db, sqlite } from "@/db";
import { DB_PATH } from "@/db/path";
import { agents, journalEntries, jobs, goals, notifications, conversations, messages } from "@/db/schema";
import { VILLAGE_TOOLS } from "./villageTools";
import { IS_WINDOWS, SHELL, SHELL_NAME, notOnThisSystem, toolWorksHere } from "./host";
import { eq, asc, desc, and, or, isNull, ne, sql as dsql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  classifyShellCommand,
  classifyFileOperation,
  classifyPackageAction,
  classifyServiceAction,
  classifyProcessTarget,
  classifyFetchUrl,
  resolvePathSafe,
  buildOverrides,
  invalidPackageArgs,
  UNIT_NAME,
  addressKind,
  type RiskResult,
  type SuperviseOverrides,
} from "./risk";
import { MAX_OUTPUT_CHARS, MAX_FETCH_BYTES, MAX_DOWNLOAD_BYTES, workspaceSkillsDir } from "./config";
import { cronProblem, nextCronRun } from "./cron";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export function ensureWorkspace(dir: string) {
  if (!fssync.existsSync(dir)) {
    fssync.mkdirSync(dir, { recursive: true });
  }
}

function truncate(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`;
}

// ---------------------------------------------------------------------------
// Tool schema (OpenAI / DeepSeek function-calling format)
// ---------------------------------------------------------------------------

const CORE_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "run_shell_command",
      description:
        `Run a shell command on the host system (in ${SHELL_NAME}) as the agent's user. Use for exploring the system, installing tools, checking status, or automating tasks. Risky commands may be blocked or queued for human approval instead of executing immediately.`,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The full shell command to execute." },
          cwd: {
            type: "string",
            description: "Working directory to run the command in. Defaults to the agent's sandbox workspace.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the contents of a text file from disk (truncated if very large).",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute or workspace-relative path." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Create or overwrite a text file. Use append=true to add to an existing file instead of replacing it.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or workspace-relative path." },
          content: { type: "string", description: "Text content to write." },
          append: { type: "boolean", description: "Append instead of overwrite. Default false." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_directory",
      description: "List files/folders in a directory, with size and type info.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute or workspace-relative path." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_path",
      description: "Delete a file or directory (recursively). Dangerous outside the sandbox workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute or workspace-relative path." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_system_status",
      description: "Get a snapshot of CPU, memory, disk, uptime and OS info for the system.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_processes",
      description: "List the top running processes sorted by CPU or memory usage.",
      parameters: {
        type: "object",
        properties: {
          sortBy: { type: "string", enum: ["cpu", "mem"], description: "Sort key. Default cpu." },
          limit: { type: "number", description: "Max rows to return. Default 20." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "manage_package",
      description:
        "Manage apt packages on the system: install, remove, upgrade, search, update the package index, or list installed packages. Supports dry-run for install/remove/upgrade to preview what would change.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["install", "remove", "upgrade", "search", "update", "list"] },
          packages: {
            type: "array",
            items: { type: "string" },
            description: "Package names, or a search query for action=search. Not required for action=update/list.",
          },
          dryRun: {
            type: "boolean",
            description: "Preview the change without applying it (apt -s). Default false.",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "manage_service",
      description: "Start, stop, restart, enable, disable, or check the status of a systemd service.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "stop", "restart", "enable", "disable", "status"] },
          service: { type: "string", description: "The systemd unit name, e.g. 'nginx'." },
        },
        required: ["action", "service"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "fetch_url",
      description: "Fetch a URL over HTTP(S) and return the response body (truncated). Web pages come back as their readable text, without the HTML. Useful for research.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string", enum: ["GET", "POST"], description: "Default GET." },
          body: { type: "string", description: "Optional request body for POST." },
          raw: { type: "boolean", description: "Return the raw HTML of a web page instead of its text." },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_journal",
      description:
        "Log or update an entry in your own persistent journal describing what you are working on, exploring, or thinking about, so the human can see your progress over time. Write one when you start or finish real work; in an ordinary chat, only when something worth remembering happened. This never requires approval.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          category: {
            type: "string",
            enum: ["exploration", "task", "reflection", "idea", "system"],
          },
          status: { type: "string", enum: ["open", "in_progress", "done", "abandoned"] },
          entryId: { type: "number", description: "Provide to update an existing entry instead of creating a new one." },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "schedule_job",
      description:
        "Create or update a recurring job that gives you your own scheduled work window on this machine. Use this to check on things, run experiments, or pursue your goals on a schedule without a human asking. Jobs run in the background via a worker, subject to the human's frequency and duration limits.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name for the job." },
          instruction: { type: "string", description: "What you should do during each work window." },
          intervalMinutes: { type: "number", description: "How often the job fires, in minutes (min 5). Default 60." },
          maxDurationMinutes: { type: "number", description: "Max minutes to spend per run. Default 10." },
          cron: {
            type: "string",
            description: "Optional standard 5-field cron expression (min hour dom month dow). If set, it overrides intervalMinutes for scheduling.",
          },
          jobId: { type: "number", description: "Provide to update an existing job instead of creating one." },
          enabled: { type: "boolean", description: "Set false to pause this job without deleting it." },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_jobs",
      description: "List all of your scheduled jobs with their next run time and last status.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_job",
      description: "Disable (pause) one of your scheduled jobs so it no longer fires.",
      parameters: {
        type: "object",
        properties: { jobId: { type: "number", description: "The job id to disable." } },
        required: ["jobId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "manage_goal",
      description:
        "Create, update, or retire a goal on your goals board. Each goal has notes: where the work stands, what you found, what's next. Keep them up to date (addNote) so you can pick the work up in a later session; they are your memory of the work.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          status: { type: "string", enum: ["backlog", "in_progress", "done", "abandoned"] },
          priority: { type: "number", description: "1 = highest priority. Default 3." },
          goalId: { type: "number", description: "Provide to update an existing goal." },
          notes: { type: "string", description: "Replace the goal's notes: where the work stands, what's next. Your memory between sessions." },
          addNote: { type: "string", description: "Add one dated line to the goal's notes (keeps the rest)." },
          conversationId: {
            type: "number",
            description: "Optional. Bind this goal to a specific chat session (defaults to the current session on create). Leave unset to make it a global goal used in work windows.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_goals",
      description: "List everything on your goals board so you can decide what to work on next.",
      parameters: { type: "object", properties: {} },
    },
  },
  // One way to reach the human (#70): a message in the conversation, and for
  // anything more than "info" a letter in their mailbox too.
  {
    type: "function" as const,
    function: {
      name: "message_owner",
      description:
        "Send the human a message. It's left in the conversation (the current one, or conversationId). With severity success, warning or critical it also rings their bell as a letter. Use it for progress they'd want, a question only they can answer, an error you can't fix, or a finished milestone. A few per session at most.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "What to tell them." },
          title: { type: "string", description: "A short headline, for a letter." },
          severity: { type: "string", enum: ["info", "success", "warning", "critical"], description: "Default info (no letter)." },
          conversationId: { type: "number", description: "Optional. Which conversation; defaults to the current one." },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "query_database",
      description:
        "Run a read-only SQL SELECT query against the app's own SQLite database (conversations, messages, tool_executions, journal_entries, jobs, work_sessions, goals, notifications, agent_settings). Use it only when the human asks about these records (past sessions, spending, history) — not to check on yourself. Only SELECT/WITH are allowed; anything else is blocked.",
      parameters: {
        type: "object",
        properties: { sql: { type: "string", description: "A read-only SELECT query." } },
        required: ["sql"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "download_file",
      description:
        "Download a URL to a file on disk (sandbox workspace by default). Safer than piping a remote script into a shell because the content is never executed.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          path: { type: "string", description: "Destination path (workspace-relative or absolute)." },
          timeoutSec: { type: "number", description: "Timeout in seconds. Default 30." },
        },
        required: ["url", "path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description:
        "Replace an exact substring in a text file. Safer than rewriting a whole file when you only need a targeted change. Fails if the match is ambiguous unless replaceAll is set.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldText: { type: "string", description: "Exact text to find. Must match exactly once by default." },
          newText: { type: "string" },
          replaceAll: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match." },
        },
        required: ["path", "oldText", "newText"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web and return results with titles, URLs, and snippets. Use for research, fact-checking, or finding up-to-date information you don't already know.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
          maxResults: { type: "number", description: "Max results to return (1-10). Default 5." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "take_screenshot",
      description:
        "Capture a screenshot of the system's display (requires 'scrot' or ImageMagick 'import' to be installed). Saved to the sandbox workspace by default.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Destination path (default: workspace/screenshots/shot-<ts>.png)." },
        },
      },
    },
  },
];

// The core tools, then the village's (villageTools.ts).
export const ALL_TOOL_DEFINITIONS = [...CORE_TOOL_DEFINITIONS, ...Object.values(VILLAGE_TOOLS).map((t) => t.definition)];

// Linux-only tools (apt, systemctl, scrot) are left out on other systems.
export function getEnabledToolDefinitions(enabledTools: string[]) {
  return ALL_TOOL_DEFINITIONS.filter((t) => enabledTools.includes(t.function.name) && toolWorksHere(t.function.name));
}

// ---------------------------------------------------------------------------
// Risk evaluation dispatcher
// ---------------------------------------------------------------------------

export function evaluateToolRisk(
  tool: string,
  args: Record<string, unknown>,
  settings: AgentSettingsRow,
): RiskResult {
  const extraProtected = (settings.extraProtectedPaths as string[]) || [];
  const overrides = buildOverrides(settings);
  // The village's own tools carry their risk with them (villageTools.ts).
  const village = VILLAGE_TOOLS[tool];
  if (village) return village.risk;
  switch (tool) {
    case "run_shell_command":
      return classifyShellCommand(String(args.command || ""), overrides);
    case "read_file":
      return classifyFileOperation("read", String(args.path || ""), settings.workspaceDir, extraProtected, overrides);
    case "write_file":
      return classifyFileOperation("write", String(args.path || ""), settings.workspaceDir, extraProtected, overrides);
    case "delete_path":
      return classifyFileOperation("delete", String(args.path || ""), settings.workspaceDir, extraProtected, overrides);
    case "list_directory":
      return classifyFileOperation("list", String(args.path || ""), settings.workspaceDir, extraProtected, overrides);
    case "get_system_status":
    case "list_processes":
      return { risk: "low", reason: "Read-only system information." };
    case "manage_package":
      return classifyPackageAction(
        (args.action as "install" | "remove" | "upgrade" | "search" | "update" | "list") || "list",
        (args.packages as string[]) || [],
        overrides,
      );
    case "manage_service":
      return classifyServiceAction(
        (args.action as "start" | "stop" | "restart" | "enable" | "disable" | "status") || "status",
        String(args.service || ""),
        overrides,
      );
    case "fetch_url":
      if (!settings.allowNetworkFetch) {
        return { risk: "blocked", reason: "Outbound network fetches are disabled in settings." };
      }
      return classifyFetchUrl(String(args.url || ""));
    case "update_journal":
      return { risk: "low", reason: "Journal writes are self-contained and always allowed." };
    case "schedule_job":
      return { risk: "medium", reason: "Creating or modifying a recurring work schedule on this machine." };
    case "list_jobs":
      return { risk: "low", reason: "Read-only listing of scheduled jobs." };
    case "cancel_job":
      return { risk: "low", reason: "Pausing one of the agent's own scheduled jobs." };
    case "manage_goal":
    case "list_goals":
      return { risk: "low", reason: "Self-contained goals-board bookkeeping." };
    case "message_owner":
    case "notify_human":
      return { risk: "low", reason: "A message for the human; no system access." };
    case "post_message":
      return { risk: "low", reason: "Posts a message into a chat session; no system access." };
    case "query_database":
      return { risk: "medium", reason: "Read-only access to the app's own database (SELECT only)." };
    case "download_file": {
      const urlRisk = classifyFetchUrl(String(args.url || ""));
      if (urlRisk.risk === "blocked") return urlRisk;
      const destRisk = classifyFileOperation("write", String(args.path || ""), settings.workspaceDir, extraProtected, overrides);
      const rank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3, blocked: 4 };
      const combined = rank[urlRisk.risk] >= rank[destRisk.risk] ? urlRisk.risk : destRisk.risk;
      return { risk: combined, reason: `${urlRisk.reason} ${destRisk.reason}` };
    }
    case "edit_file":
      return classifyFileOperation("write", String(args.path || ""), settings.workspaceDir, extraProtected, overrides);
    case "web_search":
      if (!settings.allowNetworkFetch) {
        return { risk: "blocked", reason: "Outbound network fetches are disabled in settings." };
      }
      return { risk: "medium", reason: "Read-only web search query." };
    case "take_screenshot":
      return { risk: "low", reason: "Captures the display to an image file in the workspace." };
    default:
      return { risk: "critical", reason: "Unknown tool; defaulting to requiring human approval." };
  }
}

// Extra check specifically for process-signal style shell commands run through
// run_shell_command (kill/pkill/killall) so we can protect our own PID.
export function extraProcessGuard(command: string, overrides?: SuperviseOverrides): RiskResult | null {
  if (/\b(kill|pkill|killall|Stop-Process|spps|taskkill)\b/i.test(command)) {
    return classifyProcessTarget(command, overrides);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ToolContext {
  conversationId?: number | null;
  sessionId?: number | null;
  // The villager running the tool (#56): what it creates is theirs, and the
  // list tools show them their own things.
  agentId?: number | null;
  agentName?: string;
  // What started the turn ("message" = answering a neighbour, #57).
  trigger?: string;
}

// "Belongs to this villager" (or to no one yet, for rows from before villagers).
function ownedBy(column: AnySQLiteColumn, ctx?: ToolContext) {
  return ctx?.agentId ? or(eq(column, ctx.agentId), isNull(column)) : undefined;
}

export async function executeTool(
  tool: string,
  args: Record<string, unknown>,
  settings: AgentSettingsRow,
  ctx?: ToolContext,
): Promise<{ output: string; summary: string }> {
  ensureWorkspace(settings.workspaceDir);
  ensureWorkspace(workspaceSkillsDir(settings.workspaceDir));
  ensureWorkspace(path.join(settings.workspaceDir, "uploads"));
  ensureWorkspace(path.join(settings.workspaceDir, "screenshots"));
  ensureWorkspace(path.join(settings.workspaceDir, "notes"));

  const village = VILLAGE_TOOLS[tool];
  if (village) return village.run(args, ctx);
  switch (tool) {
    case "run_shell_command":
      return runShellCommand(String(args.command || ""), (args.cwd as string) || settings.workspaceDir, settings.commandTimeoutSec);
    case "read_file":
      return readFile(String(args.path || ""), settings.workspaceDir);
    case "write_file":
      return writeFile(String(args.path || ""), String(args.content ?? ""), Boolean(args.append), settings.workspaceDir);
    case "delete_path":
      return deletePath(String(args.path || ""), settings.workspaceDir);
    case "list_directory":
      return listDirectory(String(args.path || ""), settings.workspaceDir);
    case "get_system_status":
      return getSystemStatus();
    case "list_processes":
      return listProcesses((args.sortBy as "cpu" | "mem") || "cpu", Number(args.limit) || 20);
    case "manage_package":
      return managePackage(
        (args.action as "install" | "remove" | "upgrade" | "search" | "update" | "list") || "list",
        (args.packages as string[]) || [],
        Boolean(args.dryRun),
        settings.commandTimeoutSec,
      );
    case "manage_service":
      return manageService(
        (args.action as "start" | "stop" | "restart" | "enable" | "disable" | "status") || "status",
        String(args.service || ""),
      );
    case "fetch_url":
      return fetchUrl(String(args.url || ""), (args.method as "GET" | "POST") || "GET", args.body as string | undefined, Boolean(args.raw));
    case "update_journal":
      return updateJournal(args, ctx);
    case "schedule_job":
      return scheduleJob(args, ctx);
    case "list_jobs":
      return listJobs(ctx);
    case "cancel_job":
      return cancelJob(args, ctx);
    case "manage_goal":
      return manageGoal(args, ctx);
    case "list_goals":
      return listGoals(ctx);
    case "message_owner":
      return messageOwner(args, ctx);
    // The old two (#70), for calls already in flight.
    case "notify_human":
      return notifyHuman(args, ctx);
    case "post_message":
      return postMessage(args, ctx);
    case "query_database":
      return queryDatabase(args);
    case "download_file":
      return downloadFile(args, settings.workspaceDir);
    case "edit_file":
      return editFile(args, settings.workspaceDir);
    case "web_search":
      return webSearch(args);
    case "take_screenshot":
      return takeScreenshot(args, settings.workspaceDir);
    default:
      throw new Error(`Tool "${tool}" cannot be executed here (handled elsewhere or unknown).`);
  }
}

async function updateJournal(args: Record<string, unknown>, ctx?: ToolContext) {
  const title = String(args.title || "Untitled entry");
  const body = args.body ? String(args.body) : null;
  const category = (args.category as string) || "task";
  const status = (args.status as string) || "open";
  const entryId = args.entryId ? Number(args.entryId) : undefined;

  if (entryId) {
    const updated = await db
      .update(journalEntries)
      .set({
        title,
        body,
        category: category as "exploration" | "task" | "reflection" | "idea" | "system",
        status: status as "open" | "in_progress" | "done" | "abandoned",
        updatedAt: new Date(),
      })
      .where(and(eq(journalEntries.id, entryId), ownedBy(journalEntries.agentId, ctx)))
      .returning();
    if (updated.length) {
      return { output: `Updated journal entry #${entryId}: ${title}`, summary: `journal update #${entryId}` };
    }
    return { output: `Journal entry #${entryId} not found.`, summary: "journal update failed" };
  }
  const inserted = await db
    .insert(journalEntries)
    .values({
      title,
      body,
      category: category as "exploration" | "task" | "reflection" | "idea" | "system",
      status: status as "open" | "in_progress" | "done" | "abandoned",
      agentId: ctx?.agentId ?? null,
    })
    .returning();
  return { output: `Created journal entry #${inserted[0].id}: ${title}`, summary: `journal create #${inserted[0].id}` };
}

async function runShellCommand(command: string, cwd: string, timeoutSec: number) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: Math.max(1, timeoutSec) * 1000,
      maxBuffer: 10 * 1024 * 1024,
      shell: SHELL.path,
    });
    const output = truncate([stdout, stderr].filter(Boolean).join("\n---stderr---\n") || "(no output)");
    return { output, summary: `$ ${command}` };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const output = truncate(
      `Command failed.\n${e.killed ? "(timed out)\n" : ""}stdout:\n${e.stdout || ""}\nstderr:\n${e.stderr || e.message || ""}`,
    );
    return { output, summary: `$ ${command} (failed)` };
  }
}

async function readFile(p: string, workspaceDir: string) {
  const resolved = resolvePathSafe(p, workspaceDir);
  const content = await fs.readFile(resolved, "utf-8");
  return { output: truncate(content), summary: `read ${resolved}` };
}

async function writeFile(p: string, content: string, append: boolean, workspaceDir: string) {
  const resolved = resolvePathSafe(p, workspaceDir);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  if (append) {
    await fs.appendFile(resolved, content, "utf-8");
  } else {
    await fs.writeFile(resolved, content, "utf-8");
  }
  return { output: `Wrote ${content.length} bytes to ${resolved}`, summary: `write ${resolved}` };
}

async function deletePath(p: string, workspaceDir: string) {
  const resolved = resolvePathSafe(p, workspaceDir);
  await fs.rm(resolved, { recursive: true, force: true });
  return { output: `Deleted ${resolved}`, summary: `delete ${resolved}` };
}

async function listDirectory(p: string, workspaceDir: string) {
  const resolved = resolvePathSafe(p, workspaceDir);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const rows = await Promise.all(
    entries.map(async (e) => {
      const full = path.join(resolved, e.name);
      let size = 0;
      try {
        const st = await fs.stat(full);
        size = st.size;
      } catch {
        /* ignore */
      }
      return `${e.isDirectory() ? "d" : "-"} ${String(size).padStart(10)}  ${e.name}`;
    }),
  );
  return { output: truncate(rows.join("\n") || "(empty directory)"), summary: `list ${resolved}` };
}

async function getSystemStatus() {
  const cpus = os.cpus();
  const loadavg = os.loadavg();
  let df = "";
  let uptimeStr = "";
  try {
    df = IS_WINDOWS
      ? (await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Get-PSDrive -PSProvider FileSystem | Format-Table Name,@{n='UsedGB';e={[math]::Round($_.Used/1GB,1)}},@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}},Root -AutoSize | Out-String -Width 200"])).stdout
      : (await execAsync("df -h --output=source,size,used,avail,pcent,target -x tmpfs -x devtmpfs")).stdout;
  } catch {
    /* ignore */
  }
  try {
    if (!IS_WINDOWS) uptimeStr = (await execAsync("uptime -p")).stdout.trim();
  } catch {
    /* ignore */
  }
  const summary = {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    uptimePretty: uptimeStr || `${Math.floor(os.uptime() / 3600)}h`,
    cpuModel: cpus[0]?.model,
    cpuCount: cpus.length,
    loadavg,
    totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMB: Math.round(os.freemem() / 1024 / 1024),
    usedMemPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    disk: df.trim(),
  };
  return { output: truncate(JSON.stringify(summary, null, 2)), summary: "system status" };
}

// Run a program directly (no shell), so arguments are never interpreted as
// shell syntax. Optionally keep only the first `maxLines` lines of stdout.
async function runFile(file: string, args: string[], timeoutSec: number, maxLines?: number) {
  const shown = [file, ...args].join(" ");
  const clip = (text: string) => (maxLines ? text.split("\n").slice(0, maxLines).join("\n") : text);
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd: os.tmpdir(),
      timeout: Math.max(1, timeoutSec) * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = truncate([clip(stdout), stderr].filter(Boolean).join("\n---stderr---\n") || "(no output)");
    return { output, summary: `$ ${shown}` };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const output = truncate(
      `Command failed.\n${e.killed ? "(timed out)\n" : ""}stdout:\n${clip(e.stdout || "")}\nstderr:\n${e.stderr || e.message || ""}`,
    );
    return { output, summary: `$ ${shown} (failed)` };
  }
}

async function listProcesses(sortBy: "cpu" | "mem", limit: number) {
  const rows = Math.min(200, Math.max(1, Math.floor(limit) || 20));
  if (IS_WINDOWS) {
    const key = sortBy === "mem" ? "WorkingSet64" : "CPU";
    const ps = `Get-Process | Sort-Object ${key} -Descending | Select-Object -First ${rows} Id,ProcessName,@{n='CPUs';e={[math]::Round($_.CPU,1)}},@{n='MemMB';e={[int]($_.WorkingSet64/1MB)}} | Format-Table -AutoSize | Out-String -Width 200`;
    const res = await runFile("powershell.exe", ["-NoProfile", "-Command", ps], 20);
    return { output: res.output, summary: `top processes by ${sortBy}` };
  }
  const sortFlag = sortBy === "mem" ? "-%mem" : "-%cpu";
  const res = await runFile("ps", ["axo", "pid,ppid,%cpu,%mem,etime,comm", `--sort=${sortFlag}`], 15, rows + 1);
  return { output: res.output, summary: `top processes by ${sortBy}` };
}

async function managePackage(
  action: "install" | "remove" | "upgrade" | "search" | "update" | "list",
  packages: string[],
  dryRun: boolean,
  timeoutSec: number,
) {
  if (!toolWorksHere("manage_package")) return { output: notOnThisSystem("manage_package"), summary: "manage_package refused" };
  // Same check the risk gate uses; refuse here too in case anything bypasses it.
  const invalid = invalidPackageArgs(action, packages);
  if (invalid) return { output: `Refused: ${invalid}`, summary: "manage_package refused" };
  const sim = dryRun ? ["-s"] : [];
  if (action === "search") {
    const q = packages.join(" ");
    return runFile("apt-cache", ["search", "--names-only", q], timeoutSec, 40);
  }
  if (action === "list") {
    return packages.length ? runFile("dpkg", ["-l", ...packages], timeoutSec) : runFile("apt", ["list", "--installed"], timeoutSec, 100);
  }
  if (action === "update") return runFile("sudo", ["-n", "apt-get", ...sim, "update"], timeoutSec);
  if (action === "install") return runFile("sudo", ["-n", "apt-get", ...sim, "install", "-y", ...packages], timeoutSec);
  if (action === "upgrade") {
    return packages.length
      ? runFile("sudo", ["-n", "apt-get", ...sim, "install", "--only-upgrade", "-y", ...packages], timeoutSec)
      : runFile("sudo", ["-n", "apt-get", ...sim, "upgrade", "-y"], timeoutSec);
  }
  return runFile("sudo", ["-n", "apt-get", ...sim, "remove", "-y", ...packages], timeoutSec);
}

async function manageService(action: string, service: string) {
  if (!toolWorksHere("manage_service")) return { output: notOnThisSystem("manage_service"), summary: "manage_service refused" };
  if (!UNIT_NAME.test(service)) return { output: `Refused: invalid service name "${service}".`, summary: "manage_service refused" };
  if (!["start", "stop", "restart", "enable", "disable", "status"].includes(action)) {
    return { output: `Refused: unknown action "${action}".`, summary: "manage_service refused" };
  }
  return runFile("sudo", ["-n", "systemctl", action, service], 20);
}

// --- Network requests (#4) ----------------------------------------------------
// The risk gate classifies the URL's host name; this re-checks where it really
// points (DNS) and every redirect, so a "public" name that resolves to this
// machine or the local network can't be used to reach the dashboard.

class RefusedRequest extends Error {}

async function checkDestination(url: string, allowPrivate: boolean): Promise<string | null> {
  const r = classifyFetchUrl(url);
  if (r.risk === "blocked") return r.reason;
  if (r.risk === "critical" && !allowPrivate) return r.reason;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return null; // an address literal is already classified
  let addresses: Array<{ address: string }> = [];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    return null; // let the request itself report the DNS failure
  }
  for (const a of addresses) {
    const kind = addressKind(a.address);
    if (kind === "self") return `${host} resolves to this machine (${a.address}); requests to its own services are blocked.`;
    if (kind === "private" && !allowPrivate) return `${host} resolves to a local-network address (${a.address}); that needs the human's approval.`;
  }
  return null;
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  // A local-network URL only gets here after the human approved it.
  const allowPrivate = classifyFetchUrl(url).risk === "critical";
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    const problem = await checkDestination(current, allowPrivate);
    if (problem) throw new RefusedRequest(problem);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      if (init.method && init.method !== "GET") throw new RefusedRequest("A POST request was redirected; not following it.");
      continue;
    }
    return res;
  }
  throw new RefusedRequest("Too many redirects.");
}

// A web page's readable text: no scripts, styles or tags, entities decoded,
// blank runs squeezed. A page's markup is mostly noise to a model and costs
// tokens for nothing.
export function htmlToText(html: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const text = html
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|table|ul|ol|dt|dd)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m)
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return title ? `# ${title}\n\n${text}` : text;
}

async function fetchUrl(url: string, method: "GET" | "POST", body?: string, raw = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let res: Response;
    try {
      res = await safeFetch(url, {
        method,
        body: method === "POST" ? body : undefined,
        signal: controller.signal,
        headers: { "user-agent": "autarch-agent/1.0" },
      });
    } catch (err) {
      if (err instanceof RefusedRequest) return { output: `Refused: ${err.message}`, summary: `${method} ${url} refused` };
      throw err;
    }
    const fetched = await res.text();
    const isHtml = /html/i.test(res.headers.get("content-type") ?? "") || /^\s*<(!doctype html|html)/i.test(fetched);
    const text = isHtml && !raw ? `(the page's text; ask with raw: true for the HTML)\n\n${htmlToText(fetched)}` : fetched;
    const bytes = Buffer.byteLength(text, "utf-8");
    const clipped =
      bytes > MAX_FETCH_BYTES ? Buffer.from(text).subarray(0, MAX_FETCH_BYTES).toString("utf-8") + "\n...[truncated]" : text;
    return {
      output: truncate(`HTTP ${res.status} ${res.statusText}\n\n${clipped}`),
      summary: `${method} ${url}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function scheduleJob(args: Record<string, unknown>, ctx?: ToolContext) {
  const name = String(args.name || "Untitled job");
  const instruction = args.instruction ? String(args.instruction) : "";
  const intervalMinutes = Math.max(5, Number(args.intervalMinutes) || 60);
  const maxDurationMinutes = Math.max(1, Number(args.maxDurationMinutes) || 10);
  const cron = args.cron && String(args.cron).trim() ? String(args.cron).trim() : "";
  const enabled = args.enabled === undefined ? true : Boolean(args.enabled);
  const jobId = args.jobId ? Number(args.jobId) : undefined;
  const problem = cron ? cronProblem(cron) : null;
  if (problem) {
    return { output: `Refused: the cron expression "${cron}" won't work: ${problem}. Nothing was scheduled or changed.`, summary: "schedule refused: bad cron" };
  }

  const nextFor = (e: boolean): Date | null => {
    if (!e) return null; // leave nextRunAt untouched when disabling
    if (cron) return nextCronRun(cron, new Date()) ?? new Date(Date.now() + intervalMinutes * 60_000);
    return new Date(Date.now() + intervalMinutes * 60_000);
  };

  if (jobId) {
    const nextRunAt = nextFor(enabled);
    const updated = await db
      .update(jobs)
      .set({
        name,
        instruction,
        intervalMinutes,
        maxDurationMinutes,
        cron: cron || null,
        enabled,
        updatedAt: new Date(),
        ...(nextRunAt ? { nextRunAt } : {}),
      })
      .where(and(eq(jobs.id, jobId), ownedBy(jobs.agentId, ctx)))
      .returning();
    if (updated.length) {
      return { output: `Updated job #${updated[0].id}: ${name}`, summary: `job update #${updated[0].id}` };
    }
    return { output: `Job #${jobId} not found.`, summary: "job update failed" };
  }

  const inserted = await db
    .insert(jobs)
    .values({
      name,
      instruction,
      kind: "interval",
      intervalMinutes,
      maxDurationMinutes,
      cron: cron || null,
      enabled,
      conversationId: ctx?.conversationId ?? null,
      agentId: ctx?.agentId ?? null,
      nextRunAt: nextFor(true)!,
    })
    .returning();
  const next = inserted[0].nextRunAt.toISOString();
  const scheduleText = cron ? `cron "${cron}"` : `every ${intervalMinutes} min`;
  return {
    output: `Created job #${inserted[0].id}: ${name} (${scheduleText}, up to ${maxDurationMinutes} min). Next run ${next}.`,
    summary: `job create #${inserted[0].id}`,
  };
}

async function listJobs(ctx?: ToolContext) {
  const rows = await db.select().from(jobs).where(ownedBy(jobs.agentId, ctx)).orderBy(asc(jobs.nextRunAt));
  const text = rows.length
    ? rows
        .map(
          (j) =>
            `#${j.id} [${j.enabled ? "enabled" : "disabled"}] ${j.name} — every ${j.intervalMinutes} min, up to ${j.maxDurationMinutes} min. Next: ${j.nextRunAt.toISOString()}. Last: ${j.lastStatus ?? "never"}. Instruction: ${j.instruction || "(none)"}`,
        )
        .join("\n")
    : "(no jobs scheduled)";
  return { output: text, summary: "list jobs" };
}

async function cancelJob(args: Record<string, unknown>, ctx?: ToolContext) {
  const jobId = Number(args.jobId);
  if (!jobId) return { output: "A jobId is required.", summary: "job cancel failed" };
  const updated = await db
    .update(jobs)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), ownedBy(jobs.agentId, ctx)))
    .returning();
  if (updated.length) {
    return { output: `Disabled job #${jobId}: ${updated[0].name}.`, summary: `job cancel #${jobId}` };
  }
  return { output: `Job #${jobId} not found.`, summary: "job cancel failed" };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

async function manageGoal(args: Record<string, unknown>, ctx?: ToolContext) {
  const title = String(args.title || "Untitled goal");
  const body = args.body ? String(args.body) : null;
  const status = (args.status as "backlog" | "in_progress" | "done" | "abandoned") || "backlog";
  const priority = Number(args.priority) || 3;
  const goalId = args.goalId ? Number(args.goalId) : undefined;
  // Notes (#68): `notes` replaces them, `addNote` adds a dated line.
  const notesArg = typeof args.notes === "string" ? args.notes.trim().slice(0, 4000) : undefined;
  const addNote = typeof args.addNote === "string" ? args.addNote.trim().slice(0, 1000) : "";
  const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
  // Default to the current session so goals created in a chat are bound there.
  const conversationId =
    args.conversationId !== undefined ? Number(args.conversationId) || null : ctx?.conversationId ?? null;

  if (goalId) {
    const [current] = await db.select().from(goals).where(and(eq(goals.id, goalId), ownedBy(goals.agentId, ctx)));
    const updateValues: Record<string, unknown> = {
      title: args.title ? title : current?.title ?? title,
      body: "body" in args ? body : current?.body ?? null,
      status: args.status ? status : current?.status ?? status,
      priority: args.priority ? priority : current?.priority ?? priority,
      updatedAt: new Date(),
    };
    if (notesArg !== undefined || addNote) {
      const base = notesArg !== undefined ? notesArg : current?.notes ?? "";
      updateValues.notes = [base, addNote && `- ${stamp()} ${addNote}`].filter(Boolean).join("\n").slice(-6000);
    }
    if ("conversationId" in args) updateValues.conversationId = conversationId;
    const updated = await db
      .update(goals)
      .set(updateValues)
      .where(and(eq(goals.id, goalId), ownedBy(goals.agentId, ctx)))
      .returning();
    if (updated.length) {
      return {
        output: `Updated goal #${updated[0].id}: ${updated[0].title} (${updated[0].status}, priority ${updated[0].priority})`,
        summary: `goal update #${goalId}`,
      };
    }
    return { output: `Goal #${goalId} not found.`, summary: "goal update failed" };
  }
  const inserted = await db
    .insert(goals)
    .values({ title, body, status, priority, conversationId, agentId: ctx?.agentId ?? null, notes: [notesArg, addNote && `- ${stamp()} ${addNote}`].filter(Boolean).join("\n") || null })
    .returning();
  return {
    output: `Created goal #${inserted[0].id}: ${title} (${status}, priority ${priority})`,
    summary: `goal create #${inserted[0].id}`,
  };
}

async function listGoals(ctx?: ToolContext) {
  // Your own goals and the town's (goals with no owner).
  const rows = await db.select().from(goals).where(ownedBy(goals.agentId, ctx)).orderBy(asc(goals.priority), desc(goals.updatedAt));
  const text = rows.length
    ? rows
        .map((g) => `#${g.id} [${g.status}] (p${g.priority}) ${g.title}${g.body ? ` — ${g.body}` : ""}${g.notes ? `\n  Notes:\n  ${g.notes.split("\n").slice(-15).join("\n  ")}` : ""}`)
        .join("\n")
    : "(goals board is empty)";
  return { output: text, summary: "list goals" };
}

// ---------------------------------------------------------------------------
// Notifications / DB / downloads / editing / screenshots
// ---------------------------------------------------------------------------

async function messageOwner(args: Record<string, unknown>, ctx?: ToolContext) {
  const message = String(args.message ?? "").trim();
  if (!message) return { output: "Refused: say something (`message`).", summary: "message refused" };
  const severity = ["success", "warning", "critical"].includes(String(args.severity)) ? (String(args.severity) as "success" | "warning" | "critical") : "info";
  const conversationId = args.conversationId ? Number(args.conversationId) : ctx?.conversationId ?? null;
  const said: string[] = [];
  if (conversationId) {
    const posted = await postMessage({ content: severity === "info" ? message : `📣 ${args.title ? `${String(args.title)}\n\n` : ""}${message}`, conversationId }, ctx);
    if (posted.summary.startsWith("post_message #")) said.push(`left in conversation #${conversationId}`);
    else if (severity === "info") return { output: posted.output, summary: posted.summary };
  }
  if (severity !== "info" || !conversationId) {
    const title = args.title ? String(args.title) : message.split("\n")[0].slice(0, 80);
    const [row] = await db
      .insert(notifications)
      .values({ title, body: message, severity: severity === "info" ? "info" : severity, source: ctx?.agentName ?? "agent", agentId: ctx?.agentId ?? null })
      .returning();
    said.push(`sent as letter #${row.id}`);
  }
  return { output: `Message ${said.join(" and ")}.`, summary: `message (${severity})` };
}

async function notifyHuman(args: Record<string, unknown>, ctx?: ToolContext) {
  const title = String(args.title || "Agent notification");
  const body = args.body ? String(args.body) : null;
  const severity = (args.severity as "info" | "success" | "warning" | "critical") || "info";
  const inserted = await db
    .insert(notifications)
    .values({ title, body, severity, source: ctx?.agentName ?? "agent", agentId: ctx?.agentId ?? null })
    .returning();
  // Optionally bridge into a chat session so the message is also waiting there.
  let posted = "";
  const convId = args.conversationId ? Number(args.conversationId) : ctx?.conversationId ?? null;
  if (convId) {
    const convo = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
    if (convo.length) {
      await db
        .insert(messages)
        .values({
          conversationId: convId,
          role: "assistant",
          content: `📣 ${title}${body ? `\n\n${body}` : ""}`,
          toolName: "notify_human",
        })
        .returning();
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));
      posted = ` and posted to conversation #${convId}`;
    }
  }
  return {
    output: `Notification #${inserted[0].id} raised for the human (${severity}): ${title}${posted}`,
    summary: `notify #${inserted[0].id}`,
  };
}

// Let the agent post a message into a chat session asynchronously (default: the
// current session), so it can talk to the human even when they aren't watching.
async function postMessage(args: Record<string, unknown>, ctx?: ToolContext) {
  const content = String(args.content || "").trim();
  if (!content) return { output: "content is required.", summary: "post_message failed" };
  const targetConversation = args.conversationId ? Number(args.conversationId) : ctx?.conversationId ?? null;
  if (!targetConversation) {
    return {
      output: "No target conversation. Provide a conversationId or call from within a session.",
      summary: "post_message failed",
    };
  }
  const convo = await db.select().from(conversations).where(eq(conversations.id, targetConversation)).limit(1);
  if (!convo.length) {
    return { output: `Conversation #${targetConversation} not found.`, summary: "post_message failed" };
  }
  // Light anti-spam cap per work session (a few per turn is plenty).
  if (ctx?.sessionId) {
    const countRows = await db
      .select({ n: dsql<number>`count(*)` })
      .from(messages)
      .where(and(eq(messages.sessionId, ctx.sessionId), eq(messages.toolName, "post_message")));
    if (Number(countRows[0]?.n ?? 0) >= 4) {
      return { output: "post_message rate limit reached (max 4 per session).", summary: "post_message rate-limited" };
    }
  }
  await db
    .insert(messages)
    .values({ conversationId: targetConversation, role: "assistant", content, toolName: "post_message" })
    .returning();
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, targetConversation));
  return { output: `Posted message to conversation #${targetConversation}.`, summary: `post_message #${targetConversation}` };
}

// Columns whose values are secrets: keys, passwords, tokens, the calendar's
// private address (#125).
export const SECRET_COLUMN = /api_?key|key_?value|password|passwd|secret|token|ics_?url|calendar_?ics/i;

// query_database runs on its own read-only connection, so even a statement that
// slipped past the checks below could not change anything (#10).
let readOnlyConnection: Database.Database | null = null;
function readOnlyDb(): Database.Database {
  if (!readOnlyConnection) readOnlyConnection = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return readOnlyConnection;
}

async function queryDatabase(args: Record<string, unknown>) {
  const raw = String(args.sql || "").trim().replace(/;+$/g, "").trim();
  if (!raw) return { output: "Provide a SELECT query.", summary: "query failed" };
  if (!/^(select|with)\b/i.test(raw)) {
    return { output: "Only read-only SELECT queries are allowed.", summary: "query blocked (non-select)" };
  }
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|analyze|call|do|merge|attach|detach|pragma)\b/i.test(raw)) {
    return { output: "Only read-only SELECT queries are allowed.", summary: "query blocked (write keyword)" };
  }
  // Naming the key column in any form (alias, function, subquery) is refused,
  // so the key can't be read out under another name (#10).
  // Diaries are private (#103): a villager reads only their own, with list tools.
  if (/journal_entries/i.test(raw)) {
    return { output: "Diaries are private: query_database can't read journal_entries. Use your own journal tools.", summary: "query blocked (diaries)" };
  }
  // The calendar's private address is a secret like the key (#108).
  if (/provider_?keys/i.test(raw)) {
    return { output: "Queries that mention provider keys are not allowed.", summary: "query blocked (secret table)" };
  }
  if (/calendar_?ics|ics_?url/i.test(raw)) {
    return { output: "Queries that mention the calendar address are not allowed.", summary: "query blocked (secret column)" };
  }
  if (/api_?key/i.test(raw)) {
    return { output: "Queries that mention the API key column are not allowed.", summary: "query blocked (secret column)" };
  }
  // The email settings hold passwords (#124): not readable at all.
  if (/mail_?settings/i.test(raw)) {
    return { output: "Queries on the email settings are not allowed.", summary: "query blocked (secret table)" };
  }
  try {
    const stmt = readOnlyDb().prepare(raw);
    if (!stmt.readonly || !stmt.reader) {
      return { output: "Only read-only SELECT queries are allowed.", summary: "query blocked (not read-only)" };
    }
    // Never leak a secret back to the model, however the query was written
    // (`SELECT *`, an alias, a subquery): a result column is blanked when its
    // name, or the table column it comes from, looks secret (#125).
    const secretCols = stmt
      .columns()
      .filter((c) => SECRET_COLUMN.test(c.name) || (c.column != null && SECRET_COLUMN.test(c.column)))
      .map((c) => c.name);
    const rows = stmt.all() as Record<string, unknown>[];
    const sanitized = rows.map((r) => {
      if (!r || typeof r !== "object" || !secretCols.length) return r;
      const copy = { ...r };
      for (const k of secretCols) if (k in copy && copy[k] != null) copy[k] = "***redacted***";
      return copy;
    });
    const text = sanitized.length ? JSON.stringify(sanitized.slice(0, 50), null, 2) : "(0 rows)";
    return { output: truncate(text), summary: `SELECT (${rows.length} rows)` };
  } catch (err) {
    return { output: `Query failed: ${err instanceof Error ? err.message : String(err)}`, summary: "query failed" };
  }
}

async function editFile(args: Record<string, unknown>, workspaceDir: string) {
  const p = String(args.path || "");
  const oldText = String(args.oldText ?? "");
  const newText = String(args.newText ?? "");
  if (!p || !oldText) return { output: "path and oldText are required.", summary: "edit failed" };
  const resolved = resolvePathSafe(p, workspaceDir);
  const content = await fs.readFile(resolved, "utf-8");
  if (!content.includes(oldText)) {
    return { output: `oldText not found in ${resolved}`, summary: "edit failed (no match)" };
  }
  if (args.replaceAll) {
    const count = content.split(oldText).length - 1;
    await fs.writeFile(resolved, content.split(oldText).join(newText), "utf-8");
    return { output: `Replaced ${count} occurrence(s) in ${resolved}`, summary: `edit ${resolved} (${count})` };
  }
  const idx = content.indexOf(oldText);
  const again = content.indexOf(oldText, idx + oldText.length);
  if (again !== -1) {
    return { output: "oldText matched more than once; use replaceAll=true or a more specific match.", summary: "edit failed (ambiguous)" };
  }
  await fs.writeFile(resolved, content.slice(0, idx) + newText + content.slice(idx + oldText.length), "utf-8");
  return { output: `Edited ${resolved}`, summary: `edit ${resolved}` };
}

async function downloadFile(args: Record<string, unknown>, workspaceDir: string) {
  const url = String(args.url || "");
  const dest = String(args.path || "");
  if (!url || !dest) return { output: "Both url and path are required.", summary: "download failed" };
  const resolved = resolvePathSafe(dest, workspaceDir);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (Number(args.timeoutSec) || 30) * 1000);
  try {
    let res: Response;
    try {
      res = await safeFetch(url, { signal: controller.signal, headers: { "user-agent": "autarch-agent/1.0" } });
    } catch (err) {
      if (err instanceof RefusedRequest) return { output: `Refused: ${err.message}`, summary: `download ${url} refused` };
      throw err;
    }
    if (!res.ok) return { output: `HTTP ${res.status} ${res.statusText}`, summary: `download ${url} failed` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD_BYTES) {
      return { output: `Download aborted: exceeds ${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)}MB cap.`, summary: "download aborted (size cap)" };
    }
    await fs.writeFile(resolved, buf);
    return { output: `Downloaded ${buf.length} bytes from ${url} to ${resolved}`, summary: `download ${url}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function webSearch(args: Record<string, unknown>) {
  const query = String(args.query || "").trim();
  if (!query) return { output: "No search query provided.", summary: "web search (empty query)" };
  const maxResults = Math.min(Math.max(Number(args.maxResults) || 5, 1), 10);
  try {
    // Dynamic import so the module doesn't break if duck-duck-scrape isn't installed.
    const { search } = await import("duck-duck-scrape");
    const results = await search(query, { safeSearch: 0 });
    const items = results.results.slice(0, maxResults);
    if (!items.length) {
      return { output: `No results found for "${query}".`, summary: `web search "${query}" (0 results)` };
    }
    const formatted = items
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description || "(no description)"}`)
      .join("\n\n");
    return {
      output: truncate(`Web search results for "${query}":\n\n${formatted}`),
      summary: `web search "${query}" (${items.length} results)`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      output: `Web search failed: ${msg}`,
      summary: "web search failed",
    };
  }
}

async function takeScreenshot(args: Record<string, unknown>, workspaceDir: string) {
  if (!toolWorksHere("take_screenshot")) return { output: notOnThisSystem("take_screenshot"), summary: "screenshot refused" };
  const dir = path.join(workspaceDir, "screenshots");
  await fs.mkdir(dir, { recursive: true });
  const dest = args.path ? resolvePathSafe(String(args.path), workspaceDir) : path.join(dir, `shot-${Date.now()}.png`);
  // Quote-escape so a path containing quotes can't break out of the shell string.
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const cmd = `scrot ${q(dest)} || import -window root ${q(dest)}`;
  // Build the /api/files/ URL from the workspace-relative path so the model can embed immediately.
  const relPath = path.relative(workspaceDir, dest).replace(/\\/g, "/");
  const fileUrl = `/api/files/${relPath}`;
  try {
    await execAsync(cmd, { timeout: 15_000, shell: "/bin/bash" });
    return { output: `Saved screenshot to ${dest}\nEmbed with: ![screenshot](${fileUrl})`, summary: "screenshot" };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return {
      output: `Screenshot failed — is 'scrot' or ImageMagick 'import' installed? ${e.stderr || e.message || ""}`,
      summary: "screenshot failed",
    };
  }
}

// --- notes about neighbours (#103) ---------------------------------------------------------

export const NOTES_PER_DAY = 8;

export async function noteAbout(args: Record<string, unknown>, ctx?: ToolContext) {
  if (!ctx?.agentId) return { output: "Refused: only a villager keeps a diary.", summary: "note refused" };
  const who = String(args.villager ?? "").trim();
  const note = String(args.note ?? "").trim();
  if (!who || !note) return { output: "Refused: say who (`villager`) and what (`note`).", summary: "note refused" };
  const living = await db.select().from(agents).where(ne(agents.status, "dismissed"));
  const subject = living.find((a) => a.name.toLowerCase() === who.toLowerCase());
  if (!subject) return { output: `Refused: nobody called "${who}" lives in the village.`, summary: "note refused" };
  if (subject.id === ctx.agentId) return { output: "Refused: that's you. Use update_journal for notes about yourself.", summary: "note refused" };
  const since = Math.floor(Date.now() / 1000) - 86400;
  const { n } = sqlite
    .prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE agent_id = ? AND category = 'neighbour' AND created_at >= ?")
    .get(ctx.agentId, since) as { n: number };
  if (n >= NOTES_PER_DAY) return { output: `Refused: you've written ${NOTES_PER_DAY} notes about neighbours today. Save the rest for tomorrow.`, summary: "note refused" };
  await db.insert(journalEntries).values({
    title: `About ${subject.name}`,
    body: note.slice(0, 1000),
    category: "neighbour",
    status: "done",
    agentId: ctx.agentId,
    subjectAgentId: subject.id,
  });
  return { output: `Noted in your diary, about ${subject.name}.`, summary: `note about ${subject.name}` };
}
