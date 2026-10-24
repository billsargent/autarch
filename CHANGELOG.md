# Changelog

All notable changes to **Autarch** (formerly "DeepSeek Root Lab") — a general-purpose
framework that gives an autonomous AI agent supervised control of a computer system.

## 2026-10-25 — New land in rings, a tavern, a shop and a garden

- **See what villagers ask each other.** The guard tower has a new "Neighbours' talk" log: every
  question one villager put to another, who asked whom, when, and the answer (or that none came).
- **The village can grow outwards.** Once every plot is taken, the Mayor can propose clearing
  the next ring of land (or you can, at the map table). It takes a day; then the roads reach
  further and four more plots open, two on each road. There are four rings in all. Every ring
  follows a fixed layout drawn ahead of time; the villagers choose only what to build and where.
- **Three new buildings:** a tavern (everyone's morale +5, and idle villagers drop in), a shop
  and a garden (+3 each). The garden is new pixel art drawn for the village.
- **Fixed: "reasoning_content must be passed back" errors with DeepSeek.** A message a villager
  posted to you in the middle of a tool call broke every later turn in that conversation. Those
  messages are now sent back correctly, and in their right place.
- **Villagers know what computer they're on.** Every villager is told the system and shell in
  one line: on Windows, that commands run in Git Bash (or PowerShell when Git isn't installed),
  what doesn't exist there (apt, systemctl, sudo), and where the workspace really is. Commands
  used to fail on Windows because the command tool always used `/bin/bash`.
- **Windows commands are risk-checked like Linux ones.** Stopping processes or services,
  registry and firewall changes, user accounts, scheduled tasks, running as administrator and
  piping a download into `iex` need your approval; wiping a drive is blocked; `winget install`
  is treated like `apt install`. The framework's own files are protected however their path is
  written (`D:\…`, `D:/…` or `/d/…`).
- **Linux-only tools step aside elsewhere.** The package, service and screenshot tools (apt,
  systemctl, scrot) are hidden on Windows, and the process list and disk status use PowerShell.

## 2026-10-25 — Meetings lead to work, and the worker starts with the app

- **What a meeting agrees becomes work.** When you end a meeting, the Mayor's write-up names who
  agreed to do what, and each of those becomes a goal on that villager's board (or the town's).
  They pick it up in their next work window.
- **Villagers understand meetings are for deciding.** No tools are used in a meeting, and they
  now say what they'll do instead of apologising that their hands are tied.
- **`npm run dev` starts the background worker too,** as the deployed services do. Without the
  worker, jobs, free time, the daily vote and the farm never run. `npm run dev:web` starts the
  web app alone.
- **Scrolling a long meeting works:** the question box and the End button stay put (#115).

## 2026-10-24 — Sound, a welcome, and meeting write-ups

- **Sound (off until you switch it on).** The 🔇 button in the village bar turns on quiet music,
  with a day tune and a night tune, plus a chime when something needs your approval and a coin
  for a new letter. Music and sounds are from the free Ninja Adventure pack.
- **A welcome for new installs.** The first visit gets a short welcome. If no model key is set,
  it shows where to enter one.
- **Meetings are written up.** When you end a meeting, the Mayor writes a short summary for the
  records (shown at the long table under "Past meetings") and pins any ideas it raised on the
  notice board for the village to vote on.

## 2026-10-24 — After a live test run, and spending guard rails

- **Tested with the real model.** One meeting, one vote, one hire interview, one away-mode review
  and one free-time window, for about a cent. Everything worked, and three small things are now
  fixed:
  - a villager who repeats their own name at the start of a meeting answer has it removed;
  - updating a goal without a title reports its real title;
  - `fetch_url` returns a web page's readable text instead of raw HTML, which saves a lot of
    tokens. `raw: true` still gets the HTML.
- **A daily budget from the start.** A fresh village starts with a $2-a-day town budget
  (Mayor's ledger → Limits). Existing installs keep theirs.
- **Budget letters.** You get a letter when the village reaches 80% of the day's budget, and
  another when it's all spent.
- **What the money went on.** The vault shows today's spending by activity: chat, jobs, free
  time, meetings, votes, interviews, away-mode reviews and more.

## 2026-10-24 — How villagers remember

- **Goals have notes (#68).** A villager keeps where the work stands in its goal's notes,
  adding a dated line as it goes. The notes are shown in its work windows, and on the notice
  board for you. They replace the old `notes/plan.md`, which is moved over once (#71).
- **The diary writes itself (#69).** After every work window, and every chat that did something,
  a short entry says which tools ran, how it ended and what it cost. Villagers can still write
  their own entries and notes about neighbours.
- **One way to message you (#70).** `message_owner` replaces `notify_human` and `post_message`. A
  normal message is left in the conversation; a success, warning or critical one also comes as a
  letter.
- The whole model is written down in `docs/agents.md`.

## 2026-10-24 — The old pages retire

- **The village is the whole app now (#43, #76–#79).** The old Command Center pages are gone.
  Their addresses still work and take you to the matching room: `/chat` the cottage, `/settings`
  the Mayor's ledger, `/jobs` the workshop, `/goals` the notice board, and so on.
- The village bar's "Command Center" button is gone. Your computer at home links to the Mayor's
  ledger instead.

## 2026-10-24 — Clearer names for the dangerous switches

- **"Allow all overrides" (#42)** is the new name of the switch that turns on every supervisor
  override at once (each action still needs your approval). It's no longer confused with the
  **Unrestricted** autonomy mode, which really does turn approvals off.
- The agent is now told about each override that's on, not only when all of them are.

## 2026-10-24 — Live updates

- **Pages update the moment something changes (#74).** One live stream replaces the polling:
  chat, approvals, jobs, goals, the diary, notifications, villagers, the village itself,
  meetings, ideas, buildings and spending.
  - It includes changes made by the background worker, so a reply from a scheduled job shows up
    straight away.
  - If the stream drops, pages still refresh once a minute.

## 2026-10-24 — More than one model provider

- **Providers (#61, #62).** Mayor's ledger → Providers. Add any OpenAI-compatible server
  (OpenAI, OpenRouter, Ollama, LM Studio…), Anthropic, or another DeepSeek. List each one's
  models from the page. The town's own provider stays the one on Identity & model.
- **Each villager can use a different provider and model (#64),** set on the Villagers page. Any
  conversation can switch to another model with the 🧠 button in the cottage chat.
- **Prices per model (#63).** Set them on the Providers page; a model without one uses the
  town's prices. The vault's spending by model shows provider and model.
- **Keys stay secret (#65).** A provider's key is saved but never shown again. Keys live in their
  own table that no API returns and no villager can read. `AUTARCH_KEY_<NAME>` in the environment
  overrides a stored key.
- DeepSeek-only extras (thinking mode, passing reasoning back) are only sent to DeepSeek.

## 2026-10-24 — Housekeeping

- **Summaries cost what they cost (#30, #31).** When a long conversation is summarised, that
  model call's tokens and cost now count toward the turn. Later summaries only read what's new
  since the last one, plus the old summary, instead of everything again.
- **Spending by local time (#32):** today, daily, weekly and monthly totals all use the
  computer's own clock.
- **Faster queries (#33):** database indexes for the busiest lookups.
- **One list of default tools (#34):** shared by new installs and the database. Existing installs
  are offered new tools once.
- **No more Postgres leftovers (#47):** the app runs on SQLite.
- **CI (#49):** typecheck, lint and every test suite run on each push and pull request. `npm test`
  runs all the suites.
- **The README (#46, #50)** shows the village instead of a missing screenshot, and explains the
  `allowScripts` approvals.

## 2026-10-24 — Finishing touches

- **Your home (#110):**
  - a **keepsake chest** with the goals finished, ideas adopted and work sent out for you;
  - at dusk and at night your home, the cottages and new houses glow with lit windows;
  - the wall calendar lists what the village decided lately.
- **Meetings at the table (#83):** during a town meeting, the villagers in the town hall sit
  round the long table, each with their latest answer in a speech bubble.
- **Walking (#109, #82):** furniture now blocks your character. When the scene is bigger than
  the screen, as on a phone, the view follows you.
- **Spending (#80):** the vault shows the last 30 days by villager and by model. Each turn now
  records its model.
- **Chat (#36, #37, #38, #39):**
  - approve or deny a waiting request right in the chat, even with tool messages hidden;
  - running dots clear when a turn ends;
  - messages posted into the open conversation from elsewhere show up;
  - long event notes are readable blocks instead of squeezed pills.
- **Prompts (#40):** `{name}` and `{workspace}` in your own prompts now become the villager's
  name and folder.

## 2026-10-24 — The outbox and your calendar

- **Nothing leaves without you (#107).** When villagers write something for the outside world
  (an email, a post, a shop listing, a message), they save it as a draft (`save_draft`).
  - It lands in the **outbox** on your desk at home. Read it, change the words if you like, then
    approve or discard it.
  - There's no email or shop connection yet, so approving marks it ready and you copy it and send
    it yourself. Once a connector exists, approving will send it.
- **Your calendar on the wall (#108).** Open the wall calendar at home and paste your calendar's
  private ICS address (Google, Apple and Outlook all have one).
  - Your next two weeks appear next to the village's jobs. Weekly and daily repeats are included.
  - It's read only, and the address is kept secret from the villagers.

## 2026-10-24 — The village grows, with a farm and a bakery

- **New land (#105).** The village has spread: there's open land to the north and west, with
  the roads running out to it and four building plots beside them.
  - The Mayor can propose a house, farm, bakery or workshop on a plot, and you decide at the new
    **map table** in your home. You can also build something yourself.
  - A building takes half a day of scaffolding.
  - Each house adds beds for two more villagers, which raises how many the village has room for.
- **A farm and a bakery (#106).** Once a day the farm grows wheat, the bakery bakes it into
  bread, and everyone eats a loaf.
  - Click the farm or bakery to choose a **keeper**. It produces three times as much, and the
    keeper spends their spare time there.
  - The **pantry** at home shows the stores. Running short of bread lowers morale, but never
    stops work.
  - No model calls: it's simple bookkeeping.
- The farm's wheat field is new pixel art.

## 2026-10-24 — Ideas, votes and free time

- **Ideas on the notice board (#98).**
  - Villagers pin ideas with `propose_idea` (a few a day), and you can pin your own.
  - The village votes once a day in the daytime, or when you or the Mayor call a vote. Each
    active villager votes yes, no or abstain with a one-line reason.
  - More than half must vote. With more yes than no, the idea becomes a town goal and you're
    told; with more no than yes, it's turned down.
  - You can adopt any idea straight away, or veto it, even after it's adopted.
  - Each round of votes has a budget (default $0.15, Mayor's ledger → Limits).
- **Free time (#59).** Switch on "💭 Free time" for a villager on the Villagers page. Every four
  hours they get a few minutes, on their own budget, to explore something and maybe pin an idea.

## 2026-10-24 — Sleeping in bed

- **At night, villagers sleep in their beds (#111).** Visit someone's cottage after bedtime and
  you'll find them tucked up in bed with a 💤.

## 2026-10-24 — Notes about neighbours, and morale

- **Villagers keep notes about each other (#103).** With `note_about` a villager writes a short
  note about a neighbour into their own diary (🤝): who helped, who seems stuck. At most 8 a day.
- **Diaries stay private.** You can read them all (the bookshelves at home); villagers can't read
  each other's, not even through the database. The Mayor's review of a villager sums up what
  neighbours noted this week.
- **How everyone's doing (#104):** a new board at the notice board. It gives each villager a
  morale score from the last week's record, with the reasons spelled out, lowest first:
  - work done (up) and work dropped or refused (down);
  - neighbours' notes (up);
  - days since you last talked to them (down);
  - a spent budget (down).
  No model calls.

## 2026-10-24 — Away mode

- **Going away? (#102)** At your desk at home, set "Back by" and press "I'm going away".
  - Until then, the Mayor looks at requests waiting for your approval and may approve the low-
    and medium-risk ones, after a short review.
  - High-risk and critical requests, and his own, always wait for you.
  - He never says no: what he doesn't approve waits for you.
- **Limits:**
  - nothing at night or while everyone is paused;
  - he stops once the village has spent the away budget (default $1, Mayor's ledger → Limits).
- **When you're back** ("I'm back", or at the end date), the desk lists what he approved.
- In the balanced mode low and medium requests already run on their own, so this matters most
  in manual mode.
- The Limits page also has the budget per town meeting.

## 2026-10-24 — Town meetings

- **Call a town meeting (#81).**
  - Click "Call meeting" in the village bar, or the long table in the town hall.
  - Every active villager walks to the town hall (🏛).
  - Ask them something, and each answers in turn in their own voice: the Mayor first, then the
    others (up to six). Each hears what was said before them.
- **The Mayor can call one too** (`call_meeting`), about something the whole village should talk
  over. He opens with the topic, and you're told.
- **Limits:**
  - daytime only, one meeting at a time, one question at a time;
  - answers are talk only, with no tools;
  - each meeting has a budget (default $0.25, Mayor's ledger), and the round stops when it's
    spent.
- **The transcript** is kept as a conversation of the Mayor's. End the meeting from the table.

## 2026-10-24 — Walk the village yourself

- **You're in the village now (#109):** a character tagged "You".
  - **Moving:** walk with the arrow keys or WASD, or click open ground to walk there along the
    roads.
  - **Using things:** walk up to a building, a piece of furniture or a villager, and press
    **Space** (or E). The hint above your head says what it will do. Clicking still works
    everywhere.
- **Where you start:** at your front door, or at the door of the building you just left. Indoors
  you start in the doorway. Zoomed in, the view follows you.
- Furniture doesn't block you yet.

## 2026-10-24 — Your home

- **You have a house in the village (#110):** the beige house at the bottom right, "Your home".
  Inside:
  - **your computer** (a coder's desk with code on the screen): the machine's uptime, load,
    memory and disk, and the way to the Command Center, the system monitor, the activity log and
    spending;
  - **your desk:** the papers waiting on you (approvals, hire requests and letters);
  - **bookshelves:** read any villager's diary;
  - **the wall calendar:** the jobs coming up, and when the village sleeps and wakes;
  - **the armchair by the hearth:** invite any villager over to talk;
  - **a guitar:** strum G, C, D, Em or Am;
  - **a bed.**
- The computer, the guitar and the calendar are new pixel art, drawn for this project in the
  packs' style (`npm run village:custom-art`).
- A few spots are kept free for improvements later.

## 2026-10-24 — Hiring: directors and workers

- **Villagers have ranks (#99).** Besides the Mayor there are **directors**, who each run an area
  (the inbox, the garden, money…), and **workers**, who work for a director and wear a hi-vis vest
  🦺 in the village. Set someone's rank, area and boss on the Villagers page.
- **The village can grow by itself.** When there's more work than they can do, the Mayor or a
  director drafts a new villager (`propose_hire`): name, personality, job, tools and budget, and
  why they're needed.
- **The Mayor interviews every candidate** in a short conversation with no tools, on his own
  budget, and recommends them or not.
- **Hire requests wait at the clerk's desk in the town hall** with the interview. Edit their
  personality and budget, then welcome them or decline.
- **Or let the Mayor hire:** under Mayor's ledger → Villagers → Hiring, choose "The Mayor hires
  within the limits". A candidate he recommends is hired straight away and you're told.
- **The limits always hold:**
  - a new villager never gets more tools or budget than whoever drafted them;
  - workers can't hire;
  - only the Mayor can take on a director;
  - the village has room for a set number of villagers ("Room for", default 8), and nobody
    joins past it, not even when you approve, until you raise it.
- New villagers greet the village for their first hour ("👋 Hello! I'm Hal, new in town.").

## 2026-10-24 — The Mayor's powers

- **The Mayor can run the village (#58).** He has six tools of his own:
  - give a villager a goal (`assign_goal`) or a recurring job (`schedule_job_for`);
  - look over what a villager has been doing and spending (`review_agent`);
  - raise a problem with you (`flag`, at most 5 an hour);
  - pause one villager who's misbehaving or overspending, and let them work again
    (`pause_agent` / `resume_agent`).
- **Pauses stay under your control.** The Mayor has to say why he paused someone, and you're
  told. He can only let villagers he paused work again; anyone you paused waits for you. The
  Villagers page shows "paused by the Mayor".
- **What stays yours has no tool at all:** approvals, settings, overrides, limits, the global
  pause and dismissing anyone. The Mayor can't pause himself or the whole town. While he's
  answering a neighbour's question he can't pause, resume or assign work, so no villager can
  talk him into it.
- **Only the Mayor ever gets these tools,** whatever a villager's tool list says. They're
  checked again when they run.
- Villagers are now told they can ask their neighbours things.

## 2026-10-24 — Neighbours talk

- **Villagers can ask each other things (#57).** A new `ask_villager` tool lets a villager put a
  question, favour or hand-off to a neighbour by name. The neighbour answers in their own turn,
  on their own budget, and the reply is posted back into the asker's conversation as
  "[Reply from …]". Each pair has its own thread (shown in the neighbour's conversations).
- **It can't run away:** someone answering a question can't send questions onward, a pair is
  limited to 4 questions an hour, and nobody can be asked at night, while paused, when everyone
  is paused, or once their budget is spent.
- **You can see it happen:** the asker walks over to the neighbour with "💬 Asking …" while they
  answer.
- The new tool is switched on once for existing installs; if you switch it off, it stays off.

## 2026-10-24 — Day and night

- **The village keeps real time (#100).** Bedtime and wake-up (defaults 22:00 and 07:00) are in
  the Mayor's ledger → Pause & chat. At night the villagers go home and sleep 💤, and nothing
  starts on its own: jobs that fall due wait until morning. You can still knock and chat (a woken
  villager knows it's night and keeps it short), and approvals still work.
- **The light follows the clock:** a pink dawn, a warm dusk with the lamps lit, and night. The
  village bar shows the time.
- **"Pause everyone" looks different from night:** the village frosts over and every villager
  sleeps until you resume. The button now says what it does.
- **The personality box starts with the default text** (new villagers, the Mayor's Identity
  page and Settings), so you can edit or add to it instead of starting from nothing. Left as it
  is, it keeps following the default.

## 2026-10-24 — Villagers in the village

- **Welcome new villagers.** The Mayor's ledger has a **Villagers** page: everyone in the
  village with what they're doing and what they've spent against their budget. Welcome someone
  new (name, role, personality, look, colour, model, tools within the town's policy, daily budget
  and hourly limit), edit them, pause them or let them work, or dismiss them (with a
  confirmation; the Mayor stays).
- **Everyone walks the village.** Each villager goes where their own work takes them: the
  workshop while working, the town hall while waiting on you, home or out for a stroll when free.
  Villagers at the same spot stand side by side, and each speaks in their own bubble.
- **Talk to anyone.** Click a villager to talk with them; the drawer shows their conversations.
  T talks to the Mayor (or whoever you last talked to).
- **A cottage each.** The cottages ask whose cottage to visit; inside, the armchair and the diary
  are that villager's.
- **Owners everywhere.** Goals can be a villager's or the town's, jobs say who does them, the
  clerk's desk says who's asking, the logbook says whose call it was, and the vault's coffers
  show each villager's spending against their budget. The town's daily budget is on the Limits
  page.

## 2026-10-24 — Budgets

- **Daily budgets (#60).** Each villager can have a daily spending cap, and the village a
  town-wide one. A villager over their budget (or a village over its budget) is refused with
  the reason and when it resets; chat says so straight away, a scheduled job skips that run, and
  a turn that crosses the line stops at its next step. Spending is recorded as each step happens,
  so budgets see a turn's cost while it runs.
- **Hourly action limits per villager,** on top of the town's.
- **Fixed: the hourly action limit counted the action being checked,** so a limit of N allowed
  only N − 1 actions.

## 2026-10-24 — Villagers, behind the scenes

- **The village can have more than one villager (#55).** Each has a name, role, personality,
  look, colour, model, tools and a home folder. Your existing agent becomes **the Mayor**,
  keeping its name and personality, and everything it had (conversations, jobs, diary, letters)
  is his. Settings' agent name and personality now edit the Mayor.
- **Everything belongs to someone (#56).** Conversations, jobs, sessions, tool calls, diary
  entries and letters record their villager; a goal with no owner is a town goal anyone may pick
  up. A turn runs as its conversation's villager: their personality, their model (or the
  town's), their tools — never more than the town's tool policy allows — and their own diary
  and goals. Jobs run as their villager.
- **Pause or dismiss a villager.** A paused villager can chat but can't act, and their jobs
  wait. A dismissed villager leaves: their jobs stop and nobody can talk to them, but their
  history stays. The Mayor can't be dismissed.
- A `/api/agents` API lists villagers with what they're up to (working, waiting on you, spent
  today, last words), and adds, changes, pauses and dismisses them. The village screens come
  next.
- `npm run test:villagers` covers the upgrade, adding villagers and turns as different
  villagers against a fake model.

## 2026-10-24 — A villager, not a machine

- **The agent has a personality (#101).** A new **Personality** setting (Identity, in Settings and
  the Mayor's ledger) describes who the agent is in your words; empty means a warm,
  down-to-earth villager.
- **It talks like a person and stops reaching for tools.** The default prompt now asks for short,
  plain replies without unrequested technical detail, and says most messages need no tools: use
  one only for a task you asked for or a live fact it can't know, with as few calls as possible,
  and never poke at the database, the journal or its own costs unless asked. (Before, one hello
  could set off a dozen tool calls.) Scheduled work keeps its get-things-done instructions.
- **The speech bubble says something short, then stops.** It shows the first plain sentence of the
  latest reply (no code, tables or lists) for 30 seconds.
- Database upgrades now also run when a dev server hot-reloads, so new columns arrive without a
  restart.

## 2026-10-23 — The worker: opt-in free time, real cron checks, clean shutdown

- **Nothing autonomous runs until you ask (#52).** New installs get the self-directed work window
  and the daily self-report switched off. A new **Free time** page in the Mayor's ledger turns
  them on and shows the session cap they count against. Existing installs keep their current
  settings.
- **Cron schedules are really checked (#24).** A bad expression (wrong field count, out-of-range
  values, a step of 0, a backwards range, February 30th…) is refused with the reason, by the
  workshop, the Jobs page and the agent's `schedule_job` tool; it used to be accepted and
  silently fall back to the interval. `7` is accepted as Sunday.
- **The worker shuts down cleanly (#28).** On SIGTERM or Ctrl+C it stops taking work, stops the
  turn it's running (recorded as stopped, not left "running"), and exits.
- One more missing space fixed (the Free time page), and `test:village` now fails on the JSX
  pattern that loses those spaces.

## 2026-10-23 — Dev server settings

- **No network address in the repo (#48).** The hosts allowed to open the dev server from another
  machine come from `ALLOWED_DEV_ORIGINS` (comma-separated), for example in `.env.local`.
- **A second dev server can run alongside the first:** `NEXT_DIST_DIR=.next-test` gives it its
  own build folder (useful for testing against a throwaway database).

## 2026-10-23 — One turn at a time, and a Stop that works

- **One turn per conversation (#18).** A chat message, an approval follow-up, "Run now" and the
  worker could all run turns in the same conversation at once, interleaving their messages. A turn
  now claims its conversation before writing anything (an SQLite write lock shared by the web
  server and the worker). A second chat message gets "already working — wait, or press Stop";
  an approval follow-up waits its turn; a scheduled job waits for the next tick.
- **A turn whose process died lets go.** Running turns keep a heartbeat. If the server restarts
  mid-turn, the conversation is free again within about 90 seconds (it used to stay stuck until
  the stale-session cleanup, up to 25 minutes later).
- **Stop works for every turn (#19),** including scheduled jobs the worker runs: the request is
  stored in the database, and the turn notices within a second, even while waiting on the model.
  A Stop that lands mid-reply is recorded as stopped, not as an empty "completed" reply.
- **"Run now" won't start a job that's already running (#27).**
- **Step-limit fixes (#20):** a turn that finishes cleanly on its last allowed step is no longer
  marked truncated, and a truncated turn ends with one closing message, not two (and one model
  call, not two).
- **Runner cleanups (#21):** one `session_start` event per turn; only read-only tools are retried
  after a failure, so a failed write or post can't happen twice; no more "after 0 retries";
  streamed tool calls missing their type or id are repaired instead of dropped; and the
  compaction, truncation and summary calls are time-boxed and stop with the turn.
- `npm run test:turns` covers all of this against a fake model server, including four processes
  racing for one conversation.

## 2026-10-23 — The village is Home

- **Home (`/`) is the village (#97).** Signing in lands there. The classic pages are all still
  available through **Command Center** in the village bar (the chat moved to `/chat`); old
  `/village` links go Home, and "Leave" in a room goes Home.
- **The mailbox** by the cottages holds the agent's notifications: new letters first (with their
  urgency), mark one or all as read, and earlier letters below. The ✉ button in the village bar
  opens it; it used to go to the Approvals page.

## 2026-10-23 — The Mayor's ledger

- **Every setting is in the town hall (#96).** The Mayor's ledger (the bookcase in the town hall)
  has a page per section: pause and chat mode, supervisor overrides, identity and model (API key,
  model list, thinking), prompts, autonomy, limits and workspace, context folding, tools, extra
  protected paths, and the fixed safeguards. Risky switches (unrestricted overrides or autonomy)
  ask first.
- **Validation errors show next to the field.** If the server refuses a value (say, 0 tool steps,
  or `/` as the workspace), the reason appears under that field and what you typed stays there to
  fix. Number and text fields save when you leave them or press Enter.
- **Two missing spaces fixed** in sentences that mixed bold text with an apostrophe or ampersand
  (the cottage's delete confirmation and the ledger's API-key warning): the build dropped the
  space after the bold part.
- The Settings page shares its logic with the ledger (`useSettings`).

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
