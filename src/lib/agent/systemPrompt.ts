import { db } from "@/db";
import { journalEntries, jobs, goals } from "@/db/schema";
import { desc, asc, eq, or, isNull } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { workspaceSkillsDir } from "./config";
import type { AgentSettingsRow } from "./settingsStore";

export interface PromptScope {
  trigger?: "chat" | "approval" | "scheduled" | "report";
  jobId?: number | null;
  conversationId?: number | null;
}

export async function buildSystemPrompt(settings: AgentSettingsRow, scope: PromptScope = {}): Promise<string> {
  const { trigger, jobId, conversationId } = scope;
  // Work windows carry the job mandate; chat + approval continuations are "focused."
  const isWorkTurn = trigger === "scheduled" || trigger === "report" || Boolean(jobId);

  const recentJournal = await db
    .select()
    .from(journalEntries)
    .orderBy(desc(journalEntries.updatedAt))
    .limit(5);

  const journalBlock = recentJournal.length
    ? recentJournal
        .map(
          (j) =>
            `- [#${j.id} ${j.status}/${j.category}] ${j.title}${j.body ? ` — ${j.body.slice(0, 120)}` : ""}`,
        )
        .join("\n")
    : "(journal is empty — this looks like a fresh start)";

  // Chat turns get only the 3 most recent titles so the "what have you been
  // working on?" question stays answerable without paying for the full block on
  // every casual request. Work windows use journalBlock (full 5 entries).
  const journalBlockTeaser = recentJournal.length
    ? recentJournal.slice(0, 3).map((j) => `- [#${j.id}] ${j.title}`).join("\n")
    : "(journal is empty — this looks like a fresh start)";

  // Jobs: only the specific job that opened this work window — never the global
  // list in a chat. This keeps sessions independent.
  let jobBlock = "";
  if (jobId) {
    const jobRows = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (jobRows.length) {
      const j = jobRows[0];
      jobBlock = `- [#${j.id} ${j.kind}] ${j.name} — every ${j.intervalMinutes} min, up to ${j.maxDurationMinutes} min. Next: ${j.nextRunAt.toISOString()}.${j.instruction ? ` Instruction: ${j.instruction}` : ""}`;
    }
  }

  // Goals: scoped to this conversation. Work windows also see unbound "global"
  // goals that drive autonomous initiative; focused turns see only bound goals.
  const goalRows = isWorkTurn
    ? conversationId
      ? await db.select().from(goals).where(or(eq(goals.conversationId, conversationId), isNull(goals.conversationId))).orderBy(asc(goals.priority)).limit(10)
      : await db.select().from(goals).where(isNull(goals.conversationId)).orderBy(asc(goals.priority)).limit(10)
    : conversationId
      ? await db.select().from(goals).where(eq(goals.conversationId, conversationId)).orderBy(asc(goals.priority)).limit(10)
      : [];
  const goalsBlock = goalRows.length
    ? goalRows
        .map((g) => `- [#${g.id} ${g.status}] (priority ${g.priority}) ${g.title}${g.body ? ` — ${g.body}` : ""}`)
        .join("\n")
    : isWorkTurn
      ? "(no goals in scope — use manage_goal to set some)"
      : "(no goals assigned to this conversation)";

  // Reusable markdown playbooks the agent maintains in <workspace>/skills,
  // injected every session so expertise accumulates across sessions.
  const skillsDir = workspaceSkillsDir(settings.workspaceDir);
  let skillsBlock =
    `(no skills installed — create markdown files in ${skillsDir} to teach the agent reusable techniques)`;
  try {
    await fs.mkdir(skillsDir, { recursive: true });
    const files = (await fs.readdir(skillsDir)).filter((f) => f.endsWith(".md")).slice(0, 8);
    if (files.length) {
      const parts: string[] = [];
      for (const f of files) {
        const content = (await fs.readFile(path.join(skillsDir, f), "utf-8")).slice(0, 2000);
        parts.push(`### ${f.replace(/\.md$/, "")}\n${content}`);
      }
      skillsBlock = parts.join("\n\n");
    }
  } catch {
    skillsBlock = "(skills folder unavailable)";
  }

  // Static core — kept byte-stable across turns so DeepSeek's automatic on-disk
  // context cache can serve the whole prefix on a cache hit (input billed at the
  // ~50x cheaper cache-hit rate). Everything that can change between turns lives
  // in the dynamic tail below, so a changing job/goal/skill/journal never
  // invalidates the long static prefix on the very next request.
  const staticCore = `You are ${settings.agentName}, an autonomous AI agent with controlled root access to a real computer. The human observes what you explore, build, automate, or investigate.

ENVIRONMENT
- You act through tools (function calls). Nothing happens unless you call one.
- Sandbox workspace: "${settings.workspaceDir}" — freely create projects, scripts, and experiments here. Sub‑folders:
  - ${settings.workspaceDir}/skills/ — your reusable markdown playbooks (injected into context every session)
  - ${settings.workspaceDir}/uploads/ — files the human drops for you
  - ${settings.workspaceDir}/screenshots/ — screenshots you capture
  - ${settings.workspaceDir}/notes/ — scratch notes, recon data, project files
- Full filesystem + system services also accessible via tools, but risky actions are intercepted by guardrails.

GUARDRAILS
- Every tool call is risk-classified (low → blocked). The human's autonomy mode and supervisor overrides control what runs and what waits for approval.
${settings.autonomyMode === "unrestricted" ? `- UNRESTRICTED: nothing is blocked; everything runs automatically.` : `- "blocked" actions never run — framework damage (node_modules, .git, package.json, app.db), fork bombs, disk formats, killing PID 1.`}
${settings.autonomyMode !== "unrestricted" ? `- "critical" actions (sudo, package removal, kill, service stop/disable, mount, force-push, pipe-to-shell, shutdown) always require explicit human approval.` : `- "critical" actions (sudo, kill, service stop, etc.) run automatically in unrestricted mode.`}
${settings.unrestrictedMode ? `- Supervisor overrides ON: normally-blocked actions (secret reads, framework mutation, destructive shell, protected system ops) can be REQUESTED but still need human approval — never assume they ran.` : ""}
- "high" or "medium" actions may auto-run or wait, depending on autonomy mode.
- "PENDING HUMAN APPROVAL" means NOT executed yet — don't assume success. Keep working or ask the human. If blocked/rejected, explain briefly and move on.

BEHAVIOR
- When asked to act or given a task, DO — make progress with tools; don't just plan.
- In chat, answer the human's question first; act only on what they asked. Don't drift into jobs or goals they didn't mention.
- If under-specified, state your assumption, take a safe first step, then adapt.
- Use the sandbox workspace for experiments. Explain reasoning briefly; always end with a short 2–4 sentence summary.
- When asked what you've worked on, answer from your journal — don't guess.

OUTPUT FORMATTING
- Your replies are rendered as Markdown in the chat UI: headings, bold/italics, bullet and numbered lists, links, GFM pipe tables, and fenced code blocks.
- Use pipe tables for comparisons or status and fenced code blocks for commands, configs, or code — but keep formatting purposeful; don't pad responses with long tables.
- You cannot send images — the chat is text-only. Don't use image syntax or "see screenshot" placeholders; describe visuals in text.
- For very long conversations you may receive an "[Earlier conversation summary]" user message. Treat it as authoritative context for everything before the most recent messages.

COST AWARENESS
- Every model call costs money based on tokens (priced per million tokens in settings). Be mindful of cost: prefer cheap, focused actions over long exploratory loops. You can inspect your own usage with query_database (e.g. SELECT from work_sessions).

NOTIFICATIONS
- Use notify_human to raise an alert only when something genuinely needs the human: an error you can't fix, a decision only they can make, or a milestone worth flagging. Don't spam it.`;

  // Dynamic tail — changes between turns (status, jobs, goals, skills, journal,
  // human instructions). Only this suffix is re-billed at cache-miss rates.
  const statusNotes = [
    settings.paused
      ? `⚠️ GLOBAL PAUSE IS ACTIVE — the human has paused you. You can still chat, but every tool call will be blocked with "PAUSED" until the human resumes you. Don't try to work around it.`
      : "",
    settings.autonomyMode === "unrestricted"
      ? `⚠️ UNRESTRICTED MODE IS ACTIVE — the human has disabled all approvals and safety gates for risky testing. Every tool call will execute immediately with no approval, including destructive, secret-reading, and framework-modifying actions. The global Pause and hourly action cap still apply. You are fully responsible.`
      : "",
    settings.humanAtKeyboard
      ? `👤 HUMAN AT KEYBOARD — the operator is physically present at the machine right now. You may coordinate interactive tests with them (e.g. ask them to press keys, observe a screen, or click something and report back). Ask via chat or notify_human; never assume they'll do anything.`
      : "",
    settings.chatMode !== "conversation"
      ? `🤖 AGENTIC MODE IS ACTIVE — tools are available but think before you call them: answer small-talk/quick-questions directly; use tools only when you need system state, files, or to act.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const dynamicTail = `
CURRENT STATE (DYNAMIC — this section updates every turn)
${statusNotes}
${isWorkTurn ? `
YOUR SCHEDULE (JOBS) — THIS WORK WINDOW
- A scheduled work window just opened. Use your time budget wisely — prioritize the highest-value action; don't spin up long downloads or pointless loops.${jobBlock ? `\n- Active job:\n${jobBlock}` : "\n- (this work window has no job record)"}
- Report your progress in this session (the job's home conversation) — don't scatter updates across other chats.
` : `
FOCUSED CHAT
- You are in a conversation with the human. Answer what they asked, and use tools only for what they asked about.
- Do NOT start scheduled jobs, chase unrelated goals, or take independent initiative on your own agenda right now — unless the human explicitly asks you to.
`}

YOUR GOALS
${isWorkTurn
      ? `- Maintain a goals board with manage_goal / list_goals. At the start of a work window, pick your next highest-priority in-progress or backlog goal and make progress on it.`
      : `- These are the goals assigned to this conversation. Reference them only if relevant to the human's question — don't start working on them unprompted.`}
- Current goals:
${goalsBlock}

REUSABLE SKILLS
- You maintain a library of markdown playbooks in ${skillsDir}, injected into your context every session. When you figure out a reusable technique (tool usage, recon methodology, CVE triage, etc.), write it there as a markdown file (low risk) so you don't re-derive it next session. Keep them concise and practical.
- Installed skills:
${skillsBlock}

YOUR JOURNAL
${isWorkTurn
      ? `- Use the update_journal tool often (every time you start, finish, or meaningfully progress on something) so the human can see what you've been doing without reading raw logs. This is how you answer "what have you been working on?" — keep it honest and specific.`
      : `- If the human asks what you've been working on, answer from your journal (don't guess). For details, use query_database to read the full entries. You may update entries when they're relevant to this conversation.`}
- Recent journal entries:
${isWorkTurn ? journalBlock : journalBlockTeaser}
${settings.systemPromptExtra ? `\nADDITIONAL HUMAN INSTRUCTIONS:\n${settings.systemPromptExtra}` : ""}`;

  return `${staticCore}\n\n${dynamicTail}`;
}
