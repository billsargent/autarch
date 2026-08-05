# Autarch — Autonomous Agent Control Framework

A general-purpose framework that gives an autonomous AI agent **controlled root-level access to a
real computer system**, wrapped in a multi-layer safety/guardrail system and supervised from a
web dashboard.

> ⚠️ **Experimental.** The agent runs with real shell, file, and system access inside
> guardrails you configure. It can install packages, manage services, schedule its own
> work windows, and pursue its own goals. Only run this on a machine you are OK with an
> AI poking around.

## Updating
When you pull new code from the repo, run `npm ci && npm run build` and restart the web server
and worker. Behavior guarantees (e.g. the conversation-mode "no tools" rule) only apply to the
latest build, not to older copied-over versions.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4
- Drizzle ORM + SQLite (local file, zero configuration)
- OpenAI SDK pointed at the DeepSeek API

## Setup

Zero configuration — **no environment variables, no external database server.**

```bash
npm install

# 1. Run the web app. It creates data/app.db and all tables automatically on first run:
npm run dev

# 2. In a second terminal, run the background scheduler:
npm run worker
```

Open http://localhost:3000. Everything is configured from the **Settings** tab and stored in
the local SQLite file `data/app.db`.

> The `db:push` / `db:generate` scripts still exist for schema maintenance, but the app creates
> its own schema at startup, so they are optional.

## What the agent can do

The agent acts through **function-calling tools**. Every tool call is risk-classified
(`low / medium / high / critical / blocked`) and either runs automatically, waits for
human approval, or is blocked entirely — see `src/lib/agent/risk.ts` and `config.ts`.

| Tool | Purpose | Typical risk |
| --- | --- | --- |
| `run_shell_command` | Arbitrary bash (timeout + output cap) | low–critical |
| `read_file` / `write_file` / `edit_file` / `list_directory` / `delete_path` | Filesystem | path-based |
| `get_system_status` / `list_processes` | OS/CPU/mem/disk/procs | low |
| `manage_package` | apt install/remove/upgrade/**search**/**update**/**dry-run** | low–critical |
| `manage_service` | systemd start/stop/restart/... | high–critical |
| `fetch_url` / `download_file` | HTTP fetch / download to disk | medium |
| `update_journal` | Writes to its persistent journal | low |
| `schedule_job` / `list_jobs` / `cancel_job` | Creates/manages its own recurring work windows | low–medium |
| `manage_goal` / `list_goals` | Maintains its own goals board | low |
| `notify_human` | Raises a dashboard notification for the human | low |
| `query_database` | Read-only SELECT against the app's own SQLite database | medium |
| `take_screenshot` | Captures the display (needs `scrot` or ImageMagick) | low |

## Key concepts

### Work sessions & limits
Every agent turn runs as a **work session** (recorded in `work_sessions`). The human
controls how often and how long it works:

- `minGapMinutes` — cooldown between autonomous sessions
- `maxSessionsPerDay` — max autonomous sessions per day
- `maxSessionMinutes` — max wall-clock duration per session
- `maxActionsPerHour` / `maxAgentSteps` — action/step caps

Human-initiated chat is never throttled; only autonomous (scheduled/report) sessions are.

### Jobs & the worker
The **agent can schedule its own jobs** (`schedule_job`) and the human can create them
in the **Jobs** tab. A separate process (`npm run worker`) polls the DB every 15s, checks
pause/cooldown/daily caps, and opens a work window by injecting an event note into the
job's conversation. A built-in **daily self-report** job is auto-seeded for 09:00.

### Token & cost tracking
Each model call's token usage is recorded per message and rolled up per session. Cost is
estimated from the per-million-token prices in **Settings → Limits**. See the stats block
on the **Activity** page.

### Goals board
The agent maintains its own goals (via `manage_goal`/`list_goals` or the **Goals** tab)
and is instructed to pick its next in-progress/backlog goal at the start of each work window.

### Global pause / kill switch
The **⏸ Pause** button (sidebar) instantly freezes all tool execution and scheduled work.
Chat still works; every tool call is blocked with `PAUSED` until resumed.

### API key & models in the UI
Enter a DeepSeek API key in **Settings** (stored in the DB, masked in the UI) and click
**Test & load models** to fetch available model names from the API and pick one.

## Safety layer

Core protections live in **code**, not the database, so neither the agent nor a
misconfiguration can remove them (`src/lib/agent/config.ts`):

- Hard-protected paths: `node_modules`, `.git`, `.env`, `src/db`, `package.json`, …
  — never writable/deletable, even with approval.
- Secret paths (`.ssh/`, `id_rsa`, `credentials.json`, `.env*`, …) — never readable.
- Protected packages / services / processes — removal/stop/kill is blocked.
- Blocked shell patterns: `rm -rf /`, `mkfs`, fork bombs, killing PID 1, `chmod -R 777 /`, …
- Critical actions (sudo, package removal, killing processes, service stop/disable,
  firewall/mount/user changes, force-push, shutdown/reboot) **always** require human
  approval regardless of autonomy mode.

### Supervisor overrides

By default a few categories are hard-blocked: **reading secrets**, **modifying the framework's
own files**, **destructive shell commands**, and **protected system operations**. In
**Settings → Supervisor overrides** the human operator can enable any of these (or flip the
master **Unrestricted mode**).

Enabling an override downgrades those actions from *blocked* to *critical* — the agent may
now **request** them, but each one still requires an explicit human approval before it runs.
Nothing executes automatically purely because an override is on.

### Unrestricted mode

**Settings → Autonomy mode → Unrestricted** disables approvals and the safety gates entirely:
**everything** runs automatically — sudo, package removal, killing processes, destructive
shell commands, reading secrets, and modifying the framework itself — with **no approval**.
It is opt-in with a confirmation prompt and is intended for risky testing only. The global
**Pause** button and the **hourly action cap** still apply as a hard stop. You are fully
responsible for anything the agent does in this mode.

> **Security note:** The DeepSeek API key is stored in the `agent_settings` row of the SQLite
> DB and masked on read (never returned to the browser). This is a local-experiment tradeoff —
> anyone with access to `data/app.db` can read it.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run worker` | Background scheduler (jobs / daily report) |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run db:generate` / `db:push` | Drizzle migrations / push schema to SQLite (optional) |
| `npm run db:studio` | Drizzle Studio |

## Architecture

```
src/
  app/            Next.js pages + API routes
  components/     React views (Chat, Journal, Jobs, Goals, Approvals, Activity, Monitor, Settings)
  lib/agent/      Agent core:
    runner.ts       agent loop, session lifecycle, risk gate, approval resume
    tools.ts        tool schemas + executors
    risk.ts         risk classifiers (shell/file/package/service/process/url)
    config.ts       hard-coded safety constants
    systemPrompt.ts builds the agent's system prompt (journal, jobs, goals, limits)
    settingsStore.ts single-row settings store
    deepseekClient.ts DeepSeek client + /models helper
  worker/index.ts Standalone scheduler process
  db/             Drizzle schema + Postgres pool
```
