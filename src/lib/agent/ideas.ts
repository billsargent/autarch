import { db, sqlite } from "@/db";
import { agents, conversations, goals, ideas, notifications, votes } from "@/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { budgetProblem, ensureMayor } from "./agents";
import { isNight } from "./daynight";
import { getSettings } from "./settingsStore";
import type { ToolContext } from "./tools";

// Ideas and voting (#98, docs/town-charter.md section 5). Anyone proposes an
// idea; a vote round asks every active villager for yes, no or abstain (one
// talk-only turn each, within the round's cost cap); with quorum (more than
// half of the active villagers) and more yes than no, it's adopted and
// becomes a town goal. More no than yes rejects it; a tie or no quorum leaves
// it open. The owner can adopt an idea straight away, or veto it at any time,
// which also takes down its goal.

export type IdeaRow = typeof ideas.$inferSelect;
type Choice = "yes" | "no" | "abstain";

export const IDEAS_PER_DAY = 3;
export const OPEN_IDEAS_MAX = 20;
const VOTES_TITLE = "Votes";

export class IdeaError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export function parseVote(text: string): Choice {
  const m = /VOTE:\s*(YES|NO|ABSTAIN)/i.exec(text);
  return (m?.[1].toLowerCase() as Choice | undefined) ?? "abstain";
}

// Quorum and majority. `active` is how many could vote.
export function tally(cast: Choice[], active: number): { yes: number; no: number; abstain: number; quorum: boolean; outcome: "adopted" | "rejected" | "open" } {
  const yes = cast.filter((c) => c === "yes").length;
  const no = cast.filter((c) => c === "no").length;
  const abstain = cast.filter((c) => c === "abstain").length;
  const quorum = cast.length * 2 > active;
  const outcome = !quorum || yes === no ? "open" : yes > no ? "adopted" : "rejected";
  return { yes, no, abstain, quorum, outcome };
}

// A conduct vote (#153): about whom, and what happens if it passes.
export interface Conduct {
  agentId: number;
  outcome: "warning" | "keeper" | "dismissal";
}

export async function proposeIdea(
  title: string,
  body: string | null,
  proposedBy: number | null,
  conduct: Conduct | null = null,
  event: { at: Date; allDay: boolean } | null = null,
  buildingId: number | null = null,
): Promise<IdeaRow> {
  const t = title.trim();
  if (!t) throw new IdeaError("An idea needs a title.", 400);
  const open = (sqlite.prepare("SELECT COUNT(*) AS n FROM ideas WHERE status IN ('open', 'voting')").get() as { n: number }).n;
  if (open >= OPEN_IDEAS_MAX) throw new IdeaError(`The notice board already has ${OPEN_IDEAS_MAX} open ideas. Vote on some first.`);
  // A building put to a vote (#199) isn't one of the Mayor's own ideas: no daily limit.
  if (proposedBy && !buildingId) {
    // Since midnight, as "today" says (#147).
    const since = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
    const mine = (sqlite.prepare("SELECT COUNT(*) AS n FROM ideas WHERE proposed_by = ? AND created_at >= ?").get(proposedBy, since) as { n: number }).n;
    if (mine >= IDEAS_PER_DAY) throw new IdeaError(`you've proposed ${IDEAS_PER_DAY} ideas today. Let the village catch up.`);
  }
  if (event && event.at.getTime() <= Date.now()) throw new IdeaError("the event's date has passed.");
  const [row] = await db
    .insert(ideas)
    .values({ title: t.slice(0, 120), body: body?.trim().slice(0, 2000) || null, proposedBy, conduct, eventAt: event?.at ?? null, eventAllDay: event?.allDay ?? false, buildingId })
    .returning();
  return row;
}

// The propose_idea tool: any villager, from work, free time or a meeting.
export async function proposeIdeaTool(args: Record<string, unknown>, ctx?: ToolContext) {
  if (!ctx?.agentId) return { output: "Refused: only a villager can pin an idea.", summary: "idea refused" };
  try {
    let event: { at: Date; allDay: boolean } | null = null;
    if (args.when != null && String(args.when).trim()) {
      const { parseWhen } = await import("./villageCalendar");
      event = parseWhen(String(args.when));
      if (!event) return { output: 'Refused: say when as a date, "2026-11-02", or a date and time, "2026-11-02 18:00".', summary: "idea refused" };
    }
    const idea = await proposeIdea(String(args.title ?? ""), args.body ? String(args.body) : null, ctx.agentId, null, event);
    return {
      output: `Pinned idea #${idea.id} on the notice board: "${idea.title}". The village will vote on it.${event ? " If it's adopted, it goes on the village calendar." : ""}`,
      summary: `idea #${idea.id}`,
    };
  } catch (err) {
    if (err instanceof IdeaError) return { output: `Refused: ${err.message}`, summary: "idea refused" };
    throw err;
  }
}

const voting = new Set<number>();

// Opens a vote on an idea (in the background; poll listIdeas).
export async function callVote(ideaId: number): Promise<IdeaRow> {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea) throw new IdeaError("No such idea.", 404);
  if (idea.status !== "open") throw new IdeaError(idea.status === "voting" ? "The vote is already under way." : `That idea is ${idea.status}.`);
  const settings = await getSettings();
  if (settings.paused) throw new IdeaError("Everyone is paused. Resume them first.");
  if (isNight(new Date(), settings.bedtime, settings.wakeTime)) throw new IdeaError(`Everyone's asleep. Votes are held in the daytime (after ${settings.wakeTime}).`);
  const [now] = await db.update(ideas).set({ status: "voting", rounds: idea.rounds + 1, lastVoteAt: new Date() }).where(eq(ideas.id, ideaId)).returning();
  voting.add(ideaId);
  void runRound(now).finally(() => voting.delete(ideaId));
  return now;
}

async function votesThread(agentId: number): Promise<number> {
  const [found] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.agentId, agentId), eq(conversations.title, VOTES_TITLE))).limit(1);
  if (found) return found.id;
  const [made] = await db.insert(conversations).values({ title: VOTES_TITLE, agentId, chatMode: "conversation" }).returning();
  return made.id;
}

async function runRound(idea: IdeaRow) {
  const settings = await getSettings();
  // Nobody votes on their own conduct (#153).
  const about = (idea.conduct as Conduct | null)?.agentId;
  const voters = (await db.select().from(agents).where(eq(agents.status, "active")).orderBy(asc(agents.id))).filter((v) => v.id !== about);
  const [proposer] = idea.proposedBy ? await db.select().from(agents).where(eq(agents.id, idea.proposedBy)) : [];
  const threads: number[] = [];
  const spent = () =>
    threads.length
      ? (sqlite.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS c FROM work_sessions WHERE trigger = 'vote' AND started_at >= ? AND conversation_id IN (${threads.map(() => "?").join(",")})`).get(Math.floor(idea.lastVoteAt!.getTime() / 1000), ...threads) as { c: number }).c
      : 0;
  try {
    for (const v of voters) {
      if (spent() >= settings.voteCostCapUsd) break;
      if (budgetProblem(v, settings)) continue;
      const thread = await votesThread(v.id);
      threads.push(thread);
      let text = "";
      try {
        const { runWhenFree } = await import("./runner");
        const note = `[Vote] Idea #${idea.id}: "${idea.title}"${idea.body ? `\n${idea.body}` : ""}\nProposed by ${proposer ? `${proposer.name} (${proposer.role})` : "the owner"}.`;
        const result = await runWhenFree({ conversationId: thread, eventNote: note, trigger: "vote" }, 2000, 5 * 60_000);
        text = [...result.newMessages].reverse().find((m) => m.role === "assistant" && m.content?.trim())?.content?.trim() ?? "";
      } catch {
        continue;
      }
      if (!text) continue;
      const reason = text.replace(/\s*VOTE:\s*(YES|NO|ABSTAIN)\s*$/i, "").trim().slice(0, 300) || null;
      await db.insert(votes).values({ ideaId: idea.id, round: idea.rounds, agentId: v.id, choice: parseVote(text), reason });
    }
  } finally {
    await settle(idea.id, voters.length);
  }
}

async function settle(ideaId: number, active: number) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea || idea.status !== "voting") return; // vetoed meanwhile
  const cast = await db.select().from(votes).where(and(eq(votes.ideaId, ideaId), eq(votes.round, idea.rounds)));
  const t = tally(cast.map((c) => c.choice), active);
  if (t.outcome === "open") {
    await db.update(ideas).set({ status: "open" }).where(eq(ideas.id, ideaId));
    return;
  }
  if (t.outcome === "rejected") {
    await db.update(ideas).set({ status: "rejected", decidedBy: "vote", decidedAt: new Date() }).where(eq(ideas.id, ideaId));
    // A building turned down by the village (#199) is declined.
    if (idea.buildingId) await (await import("./buildings")).declineBuilding(idea.buildingId).catch(() => {});
    return;
  }
  await adopt(idea, "vote", `Adopted by vote: ${t.yes} yes, ${t.no} no, ${t.abstain} abstained.`);
}

async function adopt(idea: IdeaRow, by: "vote" | "owner", note: string) {
  if (idea.conduct) return settleConduct(idea, by, note);
  if (idea.buildingId) return settleBuilding(idea, by, note);
  const [goal] = await db
    .insert(goals)
    .values({ title: idea.title, body: [idea.body, note].filter(Boolean).join("\n\n"), status: "backlog", priority: 3, agentId: null })
    .returning();
  await db.update(ideas).set({ status: "adopted", goalId: goal.id, decidedBy: by, decidedAt: new Date() }).where(eq(ideas.id, idea.id));
  // A dated idea goes on the village calendar (#173), unless its day has passed.
  let dated = "";
  if (idea.eventAt) {
    const cal = await import("./villageCalendar");
    const at = idea.eventAt;
    const pad = (n: number) => String(n).padStart(2, "0");
    const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}${idea.eventAllDay ? "" : ` ${pad(at.getHours())}:${pad(at.getMinutes())}`}`;
    const kind = /festival|fair|feast|celebrat|party|dance/i.test(idea.title) ? "festival" : /work ?day|build|repair|clean/i.test(idea.title) ? "workday" : "other";
    try {
      const e = cal.addEvent({ title: idea.title, kind, when, notes: idea.body }, { source: "idea", sourceId: idea.id });
      dated = ` It's on the village calendar for ${cal.describeWhen(e)}.`;
    } catch {
      /* its day has passed, or the calendar is full: it stays a goal */
    }
  }
  const mayor = await ensureMayor();
  await db.insert(notifications).values({
    kind: "idea",
    title: `Adopted: ${idea.title}`,
    body: `${note} It's a town goal now (#${goal.id}); the Mayor can give it to someone.${dated}`,
    severity: "success",
    source: mayor.name,
    agentId: mayor.id,
  });
}

// A building the village voted for (#199): approved and paid from the
// treasury, as if the owner had said yes; no town goal (it builds itself).
async function settleBuilding(idea: IdeaRow, by: "vote" | "owner", note: string) {
  await db.update(ideas).set({ status: "adopted", decidedBy: by, decidedAt: new Date() }).where(eq(ideas.id, idea.id));
  const mayor = await ensureMayor();
  let outcome: string;
  try {
    await (await import("./buildings")).approveBuilding(idea.buildingId!);
    outcome = "It's going up now, paid from the treasury.";
  } catch (err) {
    outcome = `It couldn't start: ${err instanceof Error ? err.message : String(err)}`;
  }
  await db.insert(notifications).values({ kind: "building", title: `Adopted: ${idea.title}`, body: `${note} ${outcome}`, severity: "success", source: mayor.name, agentId: mayor.id });
}

// The owner greenlights an idea without a vote.
export async function adoptNow(ideaId: number) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea) throw new IdeaError("No such idea.", 404);
  if (idea.status !== "open") throw new IdeaError(`That idea is ${idea.status}.`);
  await adopt(idea, "owner", "Adopted by the owner.");
}

// The owner's veto: before or after adoption. Takes its goal down too.
export async function veto(ideaId: number) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea) throw new IdeaError("No such idea.", 404);
  if (idea.status === "vetoed" || idea.status === "rejected") throw new IdeaError(`That idea is already ${idea.status}.`);
  await db.update(ideas).set({ status: "vetoed", decidedBy: "owner", decidedAt: new Date() }).where(eq(ideas.id, ideaId));
  if (idea.goalId) await db.update(goals).set({ status: "abandoned", updatedAt: new Date() }).where(eq(goals.id, idea.goalId));
  // A building still waiting is declined with it (#199).
  if (idea.buildingId) await (await import("./buildings")).declineBuilding(idea.buildingId).catch(() => {});
  (await import("./villageCalendar")).cancelEventsFrom("idea", ideaId);
}

export async function listIdeas(limit = 40) {
  const rows = await db.select().from(ideas).orderBy(desc(ideas.id)).limit(limit);
  const all = rows.length ? await db.select().from(votes).where(inArray(votes.ideaId, rows.map((r) => r.id))) : [];
  return rows.map((r) => {
    const latest = all.filter((v) => v.ideaId === r.id && v.round === r.rounds);
    return { ...r, voting: voting.has(r.id) || r.status === "voting", votes: latest.map((v) => ({ agentId: v.agentId, choice: v.choice, reason: v.reason })) };
  });
}

// The worker's daily round: the oldest open idea that's been up for an hour
// and hasn't been voted on today.
export async function dailyVote(now = new Date()): Promise<number | null> {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const votedToday = (sqlite.prepare("SELECT COUNT(*) AS n FROM ideas WHERE last_vote_at >= ?").get(Math.floor(dayStart.getTime() / 1000)) as { n: number }).n;
  if (votedToday) return null;
  const candidate = sqlite
    .prepare("SELECT id FROM ideas WHERE status = 'open' AND created_at <= ? ORDER BY id LIMIT 1")
    .get(Math.floor(now.getTime() / 1000) - 3600) as { id: number } | undefined;
  if (!candidate) return null;
  await callVote(candidate.id);
  return candidate.id;
}

// A conduct vote that passed (#153): a warning, losing a keeper post, or
// asking the owner to let them go. Dismissal itself stays the owner's.
async function settleConduct(idea: IdeaRow, by: "vote" | "owner", note: string) {
  const c = idea.conduct as Conduct;
  await db.update(ideas).set({ status: "adopted", decidedBy: by, decidedAt: new Date() }).where(eq(ideas.id, idea.id));
  const [who] = await db.select().from(agents).where(eq(agents.id, c.agentId));
  if (!who) return;
  const { logLife } = await import("./life");
  const mayor = await ensureMayor();
  if (c.outcome === "warning") {
    sqlite.prepare("UPDATE villager_life SET company = MAX(0, company - 25), energy = MAX(0, energy - 10) WHERE agent_id = ?").run(who.id);
    logLife("conduct", who.id, `The village gave ${who.name} a warning about their conduct.`);
  } else if (c.outcome === "keeper") {
    const kept = sqlite.prepare("SELECT kind FROM buildings WHERE keeper_id = ?").all(who.id) as Array<{ kind: string }>;
    sqlite.prepare("UPDATE buildings SET keeper_id = NULL WHERE keeper_id = ?").run(who.id);
    logLife("conduct", who.id, `The village voted ${who.name} out of keeping the ${kept.map((k) => k.kind).join(" and ") || "building"}.`);
  } else {
    logLife("conduct", who.id, `The village voted to ask the owner to let ${who.name} go.`);
  }
  await db.insert(notifications).values({
    kind: "idea",
    title: c.outcome === "dismissal" ? `The village asks you to let ${who.name} go` : `Conduct: ${who.name}`,
    body:
      c.outcome === "dismissal"
        ? `${note} ${idea.body ?? ""} Letting a villager go is yours alone to decide: the Villagers page, in the Mayor's ledger.`
        : `${note} ${c.outcome === "warning" ? `${who.name} has been warned.` : `${who.name} no longer keeps a building.`}`,
    severity: c.outcome === "dismissal" ? "warning" : "info",
    source: mayor.name,
    agentId: mayor.id,
  });
}
