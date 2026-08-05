# Changelog

All notable changes to **Autarch** (formerly "DeepSeek Root Lab") — a general-purpose
framework that gives an autonomous AI agent supervised control of a computer system.

## 2026-08-05 — Skills editor + job editing

- **Skills editor**: new **Skills** page (nav 🧠) to view, edit, add, and delete the agent's
  markdown playbooks, with a warning when a skill exceeds the 3000-char prompt-injection
  budget (so you can see what's silently getting truncated). Backed by new `/api/skills`
  and `/api/skills/[name]` routes (path-safe, contained to the workspace skills dir).
- **Edit existing jobs**: the Jobs UI now has an **Edit** button that reuses the schedule
  form and PATCHes the job (name, instruction, interval, max duration, cron) — e.g. tweak
  the seeded self-directed-work cadence without deleting and recreating it.

## 2026-08-05 — Renamed to Autarch, background work + session tracking + autonomy

### Rename / rebrand
- Framework renamed from "DeepSeek Root Lab" to **Autarch** ("autonomous agent control").
- Removed all laptop-specific language from the UI, agent system prompt, tool descriptions,
  comments, and deploy docs — now neutral "system / machine / host" wording.
- Deploy path updated to `/root/autarch`; `package.json` name updated.

### Background work visibility (Chat UX)
- Chat now shows **in-progress work from any session**: per-conversation live tool console,
  active-session polling, and no more auto-switching you back to a conversation mid-turn.
- Sidebar shows a pulsing **working indicator** and **unread badges** per conversation
  (persisted in localStorage so they survive reloads).

### Workspace consolidation
- Skills moved from `data/skills` into the agent workspace (`<workspace>/skills`), with a
  one-time migration. Agent-facing files now live under `skills/`, `uploads/`, `screenshots/`,
  and `notes/` inside the workspace.

### Session tracking & async messaging
- Tool execution is now conversation-aware: jobs created in a chat session are tagged with
  that session, so scheduled/self-work output lands back in the conversation where it was
  discussed.
- New `post_message` tool lets the agent write into a session asynchronously (rate-limited);
  `notify_human` can also bridge notifications into a chat session.

### Proactive autonomy
- The worker now seeds a recurring **"Self-directed work" job** (every 90 min × 10 min,
  pausable in the Jobs UI) so the agent takes initiative through the day.
- System prompt strengthened: act on goals during work windows, execute low/medium-risk
  actions autonomously, prefer doing over asking.

## 2026-08-04 — Bug fixes, live chat streaming, capabilities, ops

### Bug fixes
- **Worker daily-cap/cooldown bypass**: cap + cooldown now enforced per job, not per poll tick.
- **Shell risk-classification hole**: read-only prefix no longer masks dangerous verbs
  (`echo hi; rm -rf ...` is no longer "low"); added `rm`/redirect rules and a shell
  secret-exfiltration guard.
- **Secret reads**: `.env` / `app.db` are now read-blocked (ordering bug fixed); `app.db*`
  added to protected + secret paths.
- **Duplicate-create**: `update_journal` / `manage_goal` report "not found" instead of
  silently inserting new rows.
- **Approval replay**: original tool messages are rewritten with the approval outcome;
  approvals while paused are held.
- **Stats undercount**: today's totals aggregated in SQL, not from the latest 50 rows.
- Minor fixes: byte-safe fetch truncation, client cache key, screenshot path escaping,
  ChatView conversation-switch race, server-side confirm for unrestricted mode.

### Chat UX
- **Live streaming**: `POST /api/chat` streams SSE progress events; live tool console with
  step/status indicators and a show/hide toggle.
- Turns always end with a plain-language summary (prompt + code-enforced fallback).
- Chat sessions can be deleted from the sidebar.

### Agent capabilities
- Persistent workspace default (`/root/agent-workspace`, auto-migrated).
- **Skills folder** injected into the system prompt.
- **5-field cron schedules** for jobs (replaces interval-only scheduling); daily-report
  drift fixed.
- **Job-run history** panel in the Jobs UI.
- **Human-at-keyboard** flag.
- **File dropzone**: upload into the workspace + download endpoint with path containment.

### Ops
- WAL-safe backup script (`npm run backup`) + systemd service/timer.
- Production systemd unit for the web dashboard + deploy docs.

## 2026-08-03 — Initial framework ("DeepSeek Root Lab")

- Next.js (App Router) + SQLite (Drizzle) dashboard and agent runtime, backed by the
  DeepSeek API via the OpenAI SDK.
- Agent tools: shell commands, file read/write/edit/delete/list, system status, processes,
  apt packages, systemd services, URL fetch, journal, jobs, goals, notifications,
  read-only DB introspection, downloads, screenshots.
- Multi-layer **risk-classification safety layer** with human approvals, autonomy modes
  (manual / balanced / autonomous / unrestricted), supervisor overrides, and hard
  self-protection rules (framework files, secrets, core packages/services/processes).
- Background **worker scheduler** (interval + daily-report jobs), token/cost tracking,
  and a settings dashboard with safeguards.
