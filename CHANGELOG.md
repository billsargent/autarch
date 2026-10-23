# Changelog

All notable changes to **Autarch** (formerly "DeepSeek Root Lab") — a general-purpose
framework that gives an autonomous AI agent supervised control of a computer system.

## 2026-10-23 — The cottage

- **The cottage (#95).** Click the cottages to go inside the agent's home.
  - **The armchair by the hearth** is the full chat: every conversation (with running dots and
    unread counts), new, rename and delete (with a confirmation), each conversation's own
    agentic / just-talk mode, file upload, tool messages shown or hidden, live tool activity,
    stop, and older messages as you scroll up. On a phone the conversation list becomes a picker.
  - **The diary** is the journal: leave a note, mark entries done, delete them (with a
    confirmation).
- **"Full chat"** in the village's talk drawer opens the armchair. Rooms can be linked straight to
  a piece of furniture with `?open=<action>`.
- **Chat formatting reads well on parchment:** links, quotes, inline code and tables in the
  village use the village colors.
- The Chat and Journal pages now share their logic with the cottage (`useChat`, `useJournal`).
  Deleting a journal entry on the old page now asks first.

## 2026-10-23 — Four more rooms

- **The guard tower (#91):** the logbook is the activity log (filter by outcome, open any entry
  for its exact input, output, risk reason and who decided), and the tally board shows today's
  sessions, actions, steps, tokens and cost.
- **The observatory (#92):** the star charts are the system monitor: machine, uptime, CPU, load
  and memory gauges, disks and the busiest processes, refreshed every 15 seconds (or on demand).
- **The vault (#93):** the coffers hold the spending totals (today, week, month, year, all time)
  and the ledger breaks them down by day, week, month or year.
- **The town hall (#94):** the clerk's desk lists everything waiting on your approval, with the
  exact input, risk and reason, a note for the agent, and approve or deny; the records cabinet
  keeps the recent decisions. Inside the town hall, the approval pop-up stays away and the
  "waiting" button opens the desk.
- **"Decide later" sticks** for the rest of the browser session, so the same approval prompt no
  longer pops up again in every room. New requests still interrupt.
- **The activity log can show cancelled calls** (#41), on the old page too.
- **Any model name can be typed** in Settings (#41): the model field suggests the models loaded
  from the API but accepts any name, saving when you leave the field or press Enter. Its hint used
  to promise this while the field was a plain dropdown.
- The chat's message list no longer re-renders on unrelated changes (#41).
- Every interior now shares one wall-and-floor shell, and the old Activity, System monitor,
  Usage and Approvals pages use the same data hooks as the rooms.

## 2026-10-23 — Running as an ordinary user

- **The services run as an `autarch` user, not root (#13).** The units are renamed
  `autarch-web`, `autarch-worker` (new; it wasn't shipped before) and `autarch-backup`, and
  all of them run from `/home/autarch/autarch`. `deploy/autarch-sudoers` gives the user
  passwordless `sudo`, so the agent's `sudo` commands work; each one still waits for your
  approval. `deploy/README.md` covers a fresh install and moving an existing root install.
- **The dashboard listens on the local network (#3)**, protected by sign-in.
- **Backups are pruned (#45):** backups older than 14 days are deleted after each nightly run
  (`BACKUP_KEEP_DAYS`), and they go to `~/backups` by default.
- **New installs put the agent's workspace in the server user's home folder**
  (`~/agent-workspace`), so it's always writable. Existing installs keep their setting.

## 2026-10-23 — The workshop and the notice board

- **The workshop (#89).** Click the workshop in the village to go inside. Each job is a slip on the
  job board: run it now, pause or resume it, edit it at the workbench, check its past runs, or
  delete it (with a confirmation). New jobs are set up at the workbench, with every field the Jobs
  page has.
- **The notice board (#90)** opens right in the village. Goals are notes pinned by priority, grouped
  into being worked on, up next and taken down. Open one to change its status, edit its title,
  notes, priority or conversation, or delete it (with a confirmation). "Pin a new goal" adds one.
- **Changing a job's schedule now moves its next run (#25).** Editing the cron or interval used to
  keep the old next-run time until the job was paused and resumed.
- **New jobs report where you told them to (#26).** The chosen report conversation was ignored on
  create, so every new job made its own. `npm run test:jobs` covers both fixes.
- **Deleting a job or goal on the old pages now asks first** (#41).
- The Jobs and Goals pages and the new rooms share the same data hooks, so they always behave the
  same.

## 2026-10-23 — Dashboard sign-in

- **The dashboard needs a password (#3).** Every page and API call needs a signed-in session;
  the village art and the health check stay public. On first run the server prints a one-time
  setup code in its console, and the login page asks for it before you choose the password
  (or set `AUTARCH_PASSWORD`). The password is kept only as a salted scrypt hash in
  `data/auth.json`, which the agent can't read or change. Sessions are signed cookies
  (`httpOnly`, same-site strict) that last 30 days; changing the password signs everyone else
  out. Repeated wrong passwords or setup codes are slowed down.
- **Requests from other sites are refused.** Anything that changes state must come from the
  dashboard itself, so a web page you visit can't drive it.
- **Sign out** from the Command Center sidebar or the village bar.
- **A threat model in the README (#13):** the classifier guides the agent but isn't a sandbox;
  run the services as an ordinary user and keep the dashboard off the open internet.

## 2026-10-23 — Closing the agent's escape routes

- **The agent can't reach this machine's own services (#4).** `fetch_url` and `download_file`
  block loopback in every spelling (`127.1`, `2130706433`, `[::ffff:127.0.0.1]`, `localhost.`,
  this machine's name and addresses), check where a host name really resolves, and re-check every
  redirect. Other local-network addresses need approval. Shell commands that call the dashboard's
  control API or connect to its port are blocked.
- **Symlinks can't smuggle paths (#9).** File checks follow links to their real location, so a
  link in the workspace pointing at a secret or protected file is treated as that file;
  `/api/files` won't serve through such links either. Secret paths are also matched with Windows
  separators.
- **Settings are validated (#11).** Every field has a type and a range or allowed values. The
  workspace can't be `/`, a system folder, your home folder itself, or the framework's own folder.
  Errors show on the Settings page.
- **Custom system prompts now save.** Settings → System prompts showed them as saved, but the
  server dropped all four fields.
- **The framework's own code is protected (#12):** all of `src/` (including the guardrails),
  `scripts/`, `deploy/` and `public/`. The shell check matches protected names as path tokens, so
  `/tmp/mysrc` no longer counts as `src`.

## 2026-10-23 — Safety fixes

- **Package and service tools can no longer run injected commands (#2).** Names are checked against
  Debian package and systemd unit naming rules, invalid ones are blocked before they reach the
  approval queue, and the commands now run without a shell.
- **Approvals need an explicit decision (#5).** A request without `"approved"` or `"denied"` is
  rejected instead of counting as approval.
- **Approvals are claimed atomically (#16),** so two clicks can't run a critical action twice.
- **Approving while paused is refused (#17)** and the request stays waiting; it used to turn into a
  permanent denial.
- **Approval outcomes rewrite the right message (#15):** the tool result, not the agent's own text.
- **A failing follow-up turn no longer makes a saved decision look failed (#85).** The follow-up
  runs in the background and reports failures in the conversation.
- **Chat output is sanitized (#6):** model-written HTML passes an allowlist (markdown, images,
  video, audio), so iframes, scripts, forms and styles are dropped.
- **Workspace files are served inert (#7):** HTML and scripts as plain text, every file sandboxed
  and with `nosniff`, so an agent-written page can't act on the dashboard.
- **The API key is never sent to the browser (#8),** including after saving settings.
- **`query_database` is truly read-only (#10)** (separate read-only connection, statements checked
  by SQLite) and refuses any query naming the API key column.
- **Interrupted sessions no longer stall the worker (#23):** sessions left "running" by a crash are
  cleaned up on every worker tick.
- **The 8 skills the agent reads are now chosen alphabetically** on every OS.
- New test suite: `npm run test:safety` (runs on a throwaway database).

## 2026-10-23 — Chat mode is per conversation

- The agentic / conversation switch now belongs to **each conversation** instead of being one
  global setting. Toggling it in the chat header changes only the open conversation; others keep
  their own mode, and conversation-mode chats are marked 💬 in the sidebar.
- The Settings switch is now the **default mode for new conversations**.
- Existing conversations are migrated to whatever the global mode was, so nothing changes until
  you switch one.
- The "no tools in conversation mode" guarantee is unchanged: tools are not offered, and any tool
  call that still reaches execution is refused.
- New test: `npm run test:chatmode`.

## 2026-08-05 — Truncation model alert + tool retries

- **Tool retries**: new `toolRetries` setting (Settings → Limits, default 1). A failed tool call
  is retried up to that many times with a 1s pause between attempts. On success after retries,
  the result shows `SUCCESS (retried N times)`. On final failure, `ERROR (after N retries)`.
- **Step-limit speaks immediately**: when a turn is truncated by the step limit, the model now
  gets a final no-tools completion so it tells you *in the same turn* what it achieved and asks
  if you want it to continue — instead of going silent and waiting for the next turn.
- The `[turn]` diagnostic log is now gated behind `DEBUG=true` (was printing on every turn,
  drowning out useful info alongside Next.js dev-mode request logs).

## 2026-08-05 — Step-limit truncation event + raised default

- Raised the default `maxAgentSteps` from 8 to 16 (new installs; existing installs keep their
  current value). 8 steps was too few for meaningful tasks — the turn would silently stop
  mid-work with no indication to the human or the agent.
- When the step limit is reached and the agent was still working (had tool calls), a
  **`[TRUNCATED]` event** is now inserted into the conversation so both the human and the
  agent know the turn was cut short — send another message or wait for the next work window
  to continue. Previously it was a silent exit (only the time limit produced an event).

## 2026-08-05 — Remove conversational tool gate + add turn diagnostics

- Removed the `looksConversational` heuristic gate that was forcing `tool_choice:"none"`
  in agentic mode for short/chatty messages — it misclassified messages that needed tools
  ("how much space left", "what time is it", "whoami"), making the agent unable to call
  tools in agentic mode. The **chat-mode toggle is now the single explicit control**:
  conversation = hard no-tools, agentic = tools always available.
- Dropped `tool_choice:"none"` from the main loop and the summary completion to avoid
  provider errors when the conversation history contains prior tool calls.
- Added a per-turn diagnostic log line (`[turn] trigger chatMode model tools=N`) and
  extended the SSE `session_start` event with `toolsAvailable`/`model`/`chatMode` so the
  logs or live console reveal *why* tools are off.
- Model warning in the system prompt when the selected model is a reasoning model
  (`deepseek-reasoner`/R1), which may not support function calling.

## 2026-08-05 — Chat mode toggle (agentic vs conversation)

- New **chat mode** setting (`chatMode`, default `agentic`) with a one-click toggle in the
  Chat header and a selector in Settings.
- **Conversation mode**: direct chat runs with tools disabled — the agent answers from
  knowledge/context only and tells you to switch to agentic mode if a task needs tools.
  Tool definitions are omitted entirely in this mode, **and** the execution layer refuses
  any tool call that somehow reaches it — a hard "no tools, no matter what" guarantee
  regardless of message content or prior tool calls in the session.
- **Agentic mode**: tools available with `auto` tool_choice. (Previously had a conversational
  gate that forced `"none"` on step 0 for chatty messages — removed 2026-08-05 after it caused
  misclassification issues.)
- The Chat header toggle now **reverts + shows an error** if the server rejects the change,
  reconciles with the server periodically, and shows a **"tools disabled"** pill while in
  conversation mode.
- Scheduled and self-directed work windows always run agentic regardless of the toggle.
- Docs: deploy/README + README note that behavior guarantees require the latest deployed
  build (older copied-over versions don't enforce them).

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
