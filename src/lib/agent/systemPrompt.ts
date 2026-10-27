import { db } from "@/db";
import { journalEntries, jobs, goals } from "@/db/schema";
import { desc, asc, eq, or, isNull, and } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { workspaceSkillsDir } from "./config";
import { FOCUSED_CHAT_DEFAULT, LIFE_WINDOW_NOTE, coreDefault, fillPlaceholders, workWindowDefault } from "./promptDefaults";
import { SKILL_PROMPT_CHARS, SKILLS_IN_PROMPT } from "./limits";
import type { AgentSettingsRow } from "./settingsStore";
import { DEFAULT_PERSONA } from "./persona";
import { isNight } from "./daynight";
import { lifeBlock } from "./life";
import { villageFacts } from "./villageFacts";
import { builtInPlaybooks } from "./villagePlaybooks";
import { characterBlock, traitsOf } from "./traits";
import { villageDate, villageHours } from "./villageClock";
import type { AgentRow } from "./agents";
import type { SessionTrigger } from "./triggers";

// What the Mayor can do (#58), and what stays with the owner.
const MAYOR_NOTE = `AS MAYOR
- You look after the village: give villagers goals (assign_goal) or jobs (schedule_job_for), check on them (review_agent), pause one who's misbehaving or overspending and let them work again (pause_agent / resume_agent), and raise problems with the owner (flag).
- When a building has nobody to work it (a tavern with no innkeeper, a bakery with no baker), hire someone: propose_hire drafts a brand-new villager with that trade. Nobody turns up on their own. If someone suitable already lives here, appoint_keeper.
- Use these when there's a reason to, not every turn. Approvals, settings, limits, the global pause and dismissing anyone are the owner's alone.`;


export interface PromptScope {
  trigger?: SessionTrigger;
  jobId?: number | null;
  conversationId?: number | null;
  maxDurationMinutes?: number;
  maxSteps?: number;
  // Whether this turn exposes tools (false for a direct chat in a
  // conversation-mode conversation). Defaults to true.
  toolsAvailable?: boolean;
  // The villager taking this turn, and the others living in the village.
  agent?: AgentRow;
  neighbours?: AgentRow[];
}

export async function buildSystemPrompt(settings: AgentSettingsRow, scope: PromptScope = {}): Promise<string> {
  const { trigger, jobId, conversationId, agent } = scope;
  const name = agent?.name ?? settings.agentName;
  const persona = (agent ? agent.persona : settings.persona) || DEFAULT_PERSONA;
  // A villager's own folder inside the town workspace ("" = the workspace).
  const home = agent?.home ? `${settings.workspaceDir}/${agent.home}` : settings.workspaceDir;
  // Work windows carry the job mandate; chat + approval continuations are "focused."
  const isWorkTurn = trigger === "scheduled" || trigger === "report" || Boolean(jobId);

  // Character traits (#153) only in village talk: never in computer work, a
  // report, a review for the owner, or a chat where they may use the computer.
  const villageTalk = !isWorkTurn && (scope.toolsAvailable === false || (trigger != null && ["life", "message", "meeting", "vote", "interview"].includes(trigger)));

  // Night by the village's own clock (#150), or the owner's.
  const night = villageHours(settings.villageClock, settings.bedtime, settings.wakeTime);

  // Each villager keeps its own diary.
  const recentJournal = await db
    .select()
    .from(journalEntries)
    .where(agent ? eq(journalEntries.agentId, agent.id) : undefined)
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
  // A villager sees its own goals and the town's (no owner), not its
  // neighbours'.
  const mine = agent ? or(eq(goals.agentId, agent.id), isNull(goals.agentId)) : undefined;
  const goalRows = isWorkTurn
    ? conversationId
      ? await db.select().from(goals).where(and(mine, or(eq(goals.conversationId, conversationId), isNull(goals.conversationId)))).orderBy(asc(goals.priority)).limit(10)
      : await db.select().from(goals).where(and(mine, isNull(goals.conversationId))).orderBy(asc(goals.priority)).limit(10)
    : conversationId
      ? await db.select().from(goals).where(eq(goals.conversationId, conversationId)).orderBy(asc(goals.priority)).limit(10)
      : [];
  const goalsBlock = goalRows.length
    ? goalRows
        .map((g) => `- [#${g.id} ${g.status}] (priority ${g.priority}) ${g.title}${g.body ? ` — ${g.body}` : ""}${isWorkTurn && g.notes ? `\n  Notes (latest last):\n  ${g.notes.split("\n").slice(-8).join("\n  ")}` : ""}`)
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
    // Sorted so the same skills are chosen on every OS (Linux readdir order is arbitrary).
    const files = (await fs.readdir(skillsDir))
      .filter((f) => f.endsWith(".md"))
      .sort()
      .slice(0, SKILLS_IN_PROMPT);
    if (files.length) {
      const parts: string[] = [];
      for (const f of files) {
        const full = await fs.readFile(path.join(skillsDir, f), "utf-8");
        // A skill that's too long says so where it's cut, so the next villager
        // to edit it trims it or splits it.
        const content =
          full.length > SKILL_PROMPT_CHARS
            ? `${full.slice(0, SKILL_PROMPT_CHARS)}\n[…cut: this skill is ${full.length} characters and only ${SKILL_PROMPT_CHARS} are shown. Whoever edits it next: trim it, or move a section into its own skill file.]`
            : full;
        parts.push(`### ${f.replace(/\.md$/, "")}\n${content}`);
      }
      skillsBlock = parts.join("\n\n");
    }
  } catch {
    skillsBlock = "(skills folder unavailable)";
  }

  // Static core — use the human's custom version if set, otherwise the built-in
  // default. Both are kept byte-stable across turns so DeepSeek's on-disk context
  // cache can serve this prefix at the ~50x cheaper cache-hit rate.
  // {name} and {workspace} in the owner's own prompts (#40).
  const fill = (s: string) => fillPlaceholders(s, { name, role: agent?.role ?? null, persona, home });
  const staticCore =
    (settings.staticCorePrompt && fill(settings.staticCorePrompt)) ||
    coreDefault(settings, { name, rolePhrase: agent?.role ? `, the village's ${agent.role.toLowerCase()}` : "", persona, home });

  // Dynamic tail — changes between turns (status, jobs, goals, skills, journal,
  // human instructions). Only this suffix is re-billed at cache-miss rates.
  const statusNotes = [
    settings.paused
      ? `⚠️ GLOBAL PAUSE IS ACTIVE — the human has paused you. You can still chat, but every tool call will be blocked with "PAUSED" until the human resumes you. Don't try to work around it.`
      : "",
    settings.autonomyMode === "unrestricted"
      ? `⚠️ UNRESTRICTED MODE IS ACTIVE — the human has disabled all approvals and safety gates for risky testing. Every tool call will execute immediately with no approval, including destructive, secret-reading, and framework-modifying actions. The global Pause and hourly action cap still apply. You are fully responsible.`
      : "",
    trigger === "message"
      ? `✉ A neighbour has asked you something (the latest "[… asks]" note). Answer them directly and briefly; your reply goes back to them. You can't send questions onward in this turn.`
      : "",
    trigger === "vote"
      ? `🗳 The village is voting on an idea (the latest "[Vote]" note). Think about whether it's good for the village and worth the work, from your own point of view. Give your reason in one sentence, then end with exactly one line: "VOTE: YES", "VOTE: NO" or "VOTE: ABSTAIN".`
      : "",
    trigger === "review"
      ? `🧳 The owner is away and has trusted you to look at small requests while they're gone (the latest "[Approval request]" note). Approve it only if it's clearly safe, sensible and useful for the work it's part of; if you have any doubt, leave it for the owner. Explain in a sentence or two, then end with exactly one line: "DECISION: APPROVE" or "DECISION: LEAVE".`
      : "",
    trigger === "meeting"
      ? `🏛 You're at a town meeting in the town hall, with the owner and your neighbours. The latest "[Town meeting]" note is what's been said since you last spoke. Answer the latest question in two or three plain sentences, from your own work. Bring something new (an idea, a fact from THE VILLAGE TODAY, or a decision); if you agree with someone, say so in a few words rather than repeating them. No speeches, sayings or talk about yourself. There are no tools here: what's agreed becomes goals afterwards. Say what you'd do; don't apologise for not doing it now.`
      : "",
    trigger === "interview"
      ? `📋 You're interviewing someone who'd like to join the village (the latest "[Hire request]" note). Think about whether the village needs them, whether their personality and tools fit the job, and whether their budget is sensible. Say what you think in a few sentences, then end with exactly one line: "VERDICT: RECOMMEND" or "VERDICT: REJECT".`
      : "",
    isNight(villageDate(new Date(), settings.villageClock, settings.villageDayHours), night.bedtime, night.wakeTime)
      ? `🌙 It's night in the village (${night.bedtime}–${night.wakeTime}). You were asleep; the human knocked to talk. Keep it brief and don't start any work of your own until morning.`
      : "",
    settings.humanAtKeyboard
      ? `👤 HUMAN AT KEYBOARD — the operator is physically present at the machine right now. You may coordinate interactive tests with them (e.g. ask them to press keys, observe a screen, or click something and report back). Ask via chat or message_owner; never assume they'll do anything.`
      : "",
    scope.toolsAvailable !== false
      ? `Tools are available in this conversation. That doesn't mean use them: talk first, and reach for a tool only for a task or a live fact.`
      : `Tools are switched off in this conversation ("just talk" mode) — just chat.`,
  ]
    .filter(Boolean)
    .join("\n");

  const workWindowMinutes = scope.maxDurationMinutes ?? settings.maxSessionMinutes;
  const workWindowSteps = scope.maxSteps ?? settings.maxAgentSteps;
  const workWindowText = workWindowDefault(workWindowMinutes, workWindowSteps, jobBlock);

  const neighbours = scope.neighbours ?? [];
  const neighboursLine = neighbours.length
    ? `YOUR NEIGHBOURS\n- ${neighbours.map((n) => `${n.name} (${n.role}${n.status === "paused" ? ", resting" : ""})`).join(", ")}. You can ask one of them something with ask_villager when they'd know or it's their job.`
    : "";

  const dynamicTail = `
CURRENT STATE (DYNAMIC — this section updates every turn)
${statusNotes}${agent?.status === "paused" ? `\n⏸ ${agent.pausedBy === "mayor" ? "The Mayor" : "The human"} has paused you: you can chat, but your tools are blocked until they let you work again.` : ""}${agent?.isMayor ? `\n${MAYOR_NOTE}` : ""}
${neighboursLine}
${agent ? await villageFacts(new Date(), Boolean(agent.isMayor)) : ""}
${agent ? lifeBlock(agent.id) : ""}${villageTalk && agent ? `
${characterBlock(traitsOf(agent))}` : ""}
${isWorkTurn ? (settings.workWindowPrompt ? fill(settings.workWindowPrompt) : workWindowText) : trigger === "life" ? LIFE_WINDOW_NOTE : (settings.focusedChatPrompt ? fill(settings.focusedChatPrompt) : FOCUSED_CHAT_DEFAULT)}

YOUR GOALS
${isWorkTurn
      ? `- Maintain a goals board with manage_goal / list_goals. At the start of a work window, pick your next highest-priority in-progress or backlog goal and make progress on it.`
      : `- These are the goals assigned to this conversation. Reference them only if relevant to the human's question — don't start working on them unprompted.`}
- Current goals:
${goalsBlock}

REUSABLE SKILLS
- You maintain a library of markdown playbooks in ${skillsDir}, injected into your context every session. When you figure out a reusable technique (tool usage, recon methodology, CVE triage, etc.), write it there as a markdown file (low risk) so you don't re-derive it next session. Keep them concise and practical: each is shown up to ${SKILL_PROMPT_CHARS} characters, so give a new topic its own file rather than growing an old one.
${agent ? `- The village's own playbooks (kept current by the app):
${builtInPlaybooks(Boolean(agent.isMayor))}
` : ""}- Installed skills:
${skillsBlock}

YOUR JOURNAL
${isWorkTurn
      ? `- Use the update_journal tool often (every time you start, finish, or meaningfully progress on something) so the human can see what you've been doing without reading raw logs. This is how you answer "what have you been working on?" — keep it honest and specific.`
      : `- If the human asks what you've been up to, answer from these entries (don't guess). Only look up more if they ask for detail. Write in the journal during a chat only when you finished something worth remembering.`}
- Recent journal entries:
${isWorkTurn ? journalBlock : journalBlockTeaser}
${settings.systemPromptExtra ? `\nADDITIONAL HUMAN INSTRUCTIONS:\n${fill(settings.systemPromptExtra)}` : ""}`;

  return `${staticCore}\n\n${dynamicTail}`;
}
