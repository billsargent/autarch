import { db, sqlite } from "@/db";
import { agents, conversations, hireRequests, notifications } from "@/db/schema";
import { eq, inArray, ne } from "drizzle-orm";
import { createVillager, effectiveTools, ensureMayor, population, validateAgentInput, type AgentInput, type AgentRow } from "./agents";
import { populationCap } from "./buildings";
import { tierAllows } from "./mayorTools";
import { getSettings, type AgentSettingsRow } from "./settingsStore";
import type { ToolContext } from "./tools";
import { freeName } from "./villageNames";
import { TRAITS, checkTraits, isTraitKey, pickTraits } from "./traits";

// Hiring (#99, docs/town-charter.md section 4). The Mayor or a director
// drafts a new villager; the Mayor interviews them (one talk-only turn of his,
// on his budget); then the owner decides, or, when the owner has set hiring
// to "auto", a hire the Mayor recommends is made straight away. In both modes
// the caps hold: the population cap, the drafter's own tools and budget, and
// the town's tool policy and budget. Dismissal stays with the owner.

export type HireRequestRow = typeof hireRequests.$inferSelect;
type Result = { output: string; summary: string };

export const OPEN_REQUESTS_PER_DRAFTER = 3;

const refused = (output: string): Result => ({ output: `Refused: ${output}`, summary: "hire refused" });
const toolNames = async () => (await import("./tools")).ALL_TOOL_DEFINITIONS.map((t) => t.function.name);

function openRequests(proposedBy?: number): number {
  const sql = "SELECT COUNT(*) AS n FROM hire_requests WHERE status IN ('interviewing', 'awaiting_owner')" + (proposedBy ? " AND proposed_by = ?" : "");
  const row = (proposedBy ? sqlite.prepare(sql).get(proposedBy) : sqlite.prepare(sql).get()) as { n: number };
  return row.n;
}

// Room for one more villager? `waiting` counts requests already in the queue.
// The room is the setting plus the beds in finished houses (#105).
export function populationProblem(settings: AgentSettingsRow, waiting = 0): string | null {
  const living = population();
  const room = populationCap(settings);
  return living + waiting >= room
    ? `the village is full (${living} living here${waiting ? `, ${waiting} more waiting to join` : ""}, room for ${room}). The owner can make room, or the village can build a house.`
    : null;
}

// The checks a draft must pass, whoever drafted it. Returns the clean fields.
async function checkDraft(draft: AgentInput, drafter: AgentRow | null, settings: AgentSettingsRow) {
  const checked = validateAgentInput(draft, await toolNames(), true);
  if (!checked.ok) return { error: checked.error };
  const v = checked.value;
  const tier = v.tier ?? "worker";
  const living = await db.select().from(agents).where(ne(agents.status, "dismissed"));
  if (living.some((a) => a.name.toLowerCase() === v.name!.toLowerCase())) return { error: `someone called ${v.name} already lives here.` };
  // Never more than the town allows, nor (for a drafter) more than they have.
  const town = (settings.enabledTools as string[]) || [];
  const ceiling = drafter ? effectiveTools(drafter, settings) : town;
  const tools = (v.enabledTools as string[] | null | undefined) ?? ceiling.filter((t) => tierAllows(tier, t));
  const beyond = tools.filter((t) => !ceiling.includes(t) || !tierAllows(tier, t));
  if (beyond.length) return { error: `a new ${tier} can't have ${beyond.join(", ")}${drafter ? ` (only tools you have yourself, and that a ${tier} may hold)` : ""}.` };
  if (drafter && v.dailyBudgetUsd == null) return { error: "say what they may spend a day (`dailyBudgetUsd`)." };
  if (drafter?.dailyBudgetUsd != null && (v.dailyBudgetUsd ?? 0) > drafter.dailyBudgetUsd) {
    return { error: `their daily budget can't be more than yours ($${drafter.dailyBudgetUsd}).` };
  }
  if (settings.townDailyBudgetUsd != null && (v.dailyBudgetUsd ?? 0) > settings.townDailyBudgetUsd) {
    return { error: `their daily budget can't be more than the whole village's ($${settings.townDailyBudgetUsd}).` };
  }
  return { value: { ...v, tier, enabledTools: tools } };
}

// --- the propose_hire tool ------------------------------------------------------------

export async function proposeHire(args: Record<string, unknown>, ctx?: ToolContext): Promise<Result> {
  if (!ctx?.agentId) return refused("only a villager can draft a hire.");
  const [me] = await db.select().from(agents).where(eq(agents.id, ctx.agentId));
  if (!me || me.status === "dismissed") return refused("only a villager can draft a hire.");
  const myTier = me.isMayor ? "mayor" : me.tier;
  if (myTier === "worker") return refused("workers can't take people on. Ask your director.");
  if (ctx.trigger === "message" || ctx.trigger === "interview") return refused("not while you're answering someone. Draft hires in your own time.");
  const reason = String(args.reason ?? "").trim();
  if (!reason) return refused("say why the village needs them (`reason`).");
  const tier = args.tier === "director" ? "director" : "worker";
  if (tier === "director" && myTier !== "mayor") return refused("only the Mayor can take on a director.");

  const settings = await getSettings();
  if (openRequests(me.id) >= OPEN_REQUESTS_PER_DRAFTER) return refused(`you already have ${OPEN_REQUESTS_PER_DRAFTER} hires waiting. Wait for those first.`);
  const full = populationProblem(settings, openRequests());
  if (full) return refused(full);

  // No name, or no budget? The village picks a free name (#151), and the
  // newcomer gets the drafter's own budget.
  const living = (await db.select({ name: agents.name }).from(agents).where(ne(agents.status, "dismissed"))).map((a) => a.name);
  const named = typeof args.name === "string" && args.name.trim() ? args.name.trim() : freeName(living);
  if (!named) return refused("every name on the village's list is taken; give them a name yourself (`name`).");
  const draft: AgentInput = {
    name: named,
    role: args.role,
    persona: args.persona,
    area: args.area ?? me.area,
    tier,
    managerId: tier === "worker" ? me.id : null,
    enabledTools: args.tools ?? undefined,
    dailyBudgetUsd: args.dailyBudgetUsd ?? me.dailyBudgetUsd ?? settings.townDailyBudgetUsd ?? 1,
    character: args.character,
    // Their village trade (#131): innkeeper, baker, fisher …
    trade: typeof args.trade === "string" ? args.trade.toLowerCase().trim() : undefined,
    // Their character (#153): what the drafter chose, within the owner's
    // limit on flaws; or two good traits the village picks.
    traits: args.traits ?? pickTraits(),
  };
  const traits = checkTraits(draft.traits, settings.flawsAllowed);
  if (!traits.ok) return refused(traits.error);
  const checked = await checkDraft(draft, me, settings);
  if ("error" in checked) return refused(checked.error!);

  const [request] = await db
    .insert(hireRequests)
    .values({ proposedBy: me.id, draft: checked.value, reason, status: "interviewing" })
    .returning();
  void interview(request.id);
  const next = settings.hiringMode === "auto" ? "if he recommends them, they'll be hired" : "then the owner decides";
  return {
    output: `Drafted hire request #${request.id} for ${checked.value.name} (${tier}). The Mayor will interview them; ${next}.`,
    summary: `propose hire #${request.id}`,
  };
}

// --- the interview ------------------------------------------------------------------

function describe(draft: Record<string, unknown>): string {
  const tools = (draft.enabledTools as string[] | null) ?? [];
  return [
    `${draft.name}, ${draft.tier} — ${draft.role ?? "Villager"}${draft.area ? ` (area: ${draft.area})` : ""}.`,
    `Personality: ${draft.persona ?? "(the default)"}`,
    ...(Array.isArray(draft.traits) && draft.traits.length ? [`Traits: ${(draft.traits as string[]).map((t) => (isTraitKey(t) ? TRAITS[t].label : t)).join(", ")}.`] : []),
    `Tools: ${tools.join(", ") || "none"}.`,
    `Daily budget: ${draft.dailyBudgetUsd != null ? `$${draft.dailyBudgetUsd}` : "none of their own"}.`,
  ].join("\n");
}

export function parseVerdict(text: string): "recommend" | "reject" | "unsure" {
  const m = /VERDICT:\s*(RECOMMEND|REJECT)/i.exec(text);
  return m ? (m[1].toUpperCase() === "RECOMMEND" ? "recommend" : "reject") : "unsure";
}

async function tellOwner(title: string, body: string | null, severity: "info" | "warning" = "info") {
  const mayor = await ensureMayor();
  await db.insert(notifications).values({ kind: "hire", title, body, severity, source: mayor.name, agentId: mayor.id });
}

export async function interview(requestId: number): Promise<HireRequestRow> {
  const [request] = await db.select().from(hireRequests).where(eq(hireRequests.id, requestId));
  const draft = request.draft as Record<string, unknown>;
  const mayor = await ensureMayor();
  const [drafter] = request.proposedBy ? await db.select().from(agents).where(eq(agents.id, request.proposedBy)) : [];
  let text = "";
  let conversationId: number | null = null;
  try {
    const [conv] = await db
      .insert(conversations)
      .values({ title: `Interview: ${draft.name}`, agentId: mayor.id, chatMode: "conversation" })
      .returning();
    conversationId = conv.id;
    const { runWhenFree } = await import("./runner");
    const note = `[Hire request #${request.id}] ${drafter ? `${drafter.name} (${drafter.role})` : "The owner"} wants to take on:\n${describe(draft)}\nWhy: ${request.reason ?? "(no reason given)"}`;
    const result = await runWhenFree({ conversationId: conv.id, eventNote: note, trigger: "interview" }, 3000, 15 * 60_000);
    text = [...result.newMessages].reverse().find((m) => m.role === "assistant" && m.content?.trim())?.content?.trim() ?? "";
  } catch (err) {
    text = `The Mayor couldn't hold the interview: ${err instanceof Error ? err.message : String(err)}`;
  }
  const verdict = parseVerdict(text);
  // The verdict is shown as a badge; keep the words.
  const said = text.replace(/\s*VERDICT:\s*(RECOMMEND|REJECT)\s*$/i, "").trim();
  await db.update(hireRequests).set({ interview: said || text, verdict, conversationId }).where(eq(hireRequests.id, request.id));

  if (verdict === "reject") {
    await db.update(hireRequests).set({ status: "declined", decidedBy: "mayor", decidedAt: new Date() }).where(eq(hireRequests.id, request.id));
    await tellOwner(`The Mayor turned down hiring ${draft.name}`, "You can still hire them from the clerk's desk in the town hall.");
  } else if (verdict === "recommend" && (await getSettings()).hiringMode === "auto") {
    const done = await hire(request.id, "mayor");
    if ("error" in done) {
      await db.update(hireRequests).set({ status: "awaiting_owner" }).where(eq(hireRequests.id, request.id));
      await tellOwner(`Hire request: ${draft.name}`, `The Mayor recommends them, but ${done.error} It waits for you in the town hall.`, "warning");
    }
  } else {
    await db.update(hireRequests).set({ status: "awaiting_owner" }).where(eq(hireRequests.id, request.id));
    await tellOwner(`Hire request: ${draft.name}`, `${verdict === "recommend" ? "The Mayor recommends them." : "The Mayor didn't give a clear verdict."} Decide at the clerk's desk in the town hall.`);
  }
  const [after] = await db.select().from(hireRequests).where(eq(hireRequests.id, request.id));
  return after;
}

// --- deciding ---------------------------------------------------------------------

// Makes the hire. `by` is "owner" or "mayor"; the owner may edit the draft
// first. The caps are checked again here, whoever decides.
export async function hire(requestId: number, by: "owner" | "mayor", edits?: Record<string, unknown>): Promise<{ agent: AgentRow } | { error: string }> {
  const [request] = await db.select().from(hireRequests).where(eq(hireRequests.id, requestId));
  if (!request) return { error: "no such hire request." };
  const open = request.status === "awaiting_owner" || request.status === "interviewing" || (by === "owner" && request.status === "declined" && request.decidedBy === "mayor");
  if (!open) return { error: `that request is already ${request.status.replace("_", " ")}.` };
  if (by === "mayor" && (await getSettings()).hiringMode !== "auto") return { error: "the owner decides hires." };
  const settings = await getSettings();
  const full = populationProblem(settings);
  if (full) return { error: full };
  const [drafter] = request.proposedBy ? await db.select().from(agents).where(eq(agents.id, request.proposedBy)) : [];
  // The owner's edits are checked against the town's limits only; the
  // Mayor's hires against the drafter's too.
  const checked = await checkDraft({ ...(request.draft as AgentInput), ...(edits ?? {}) }, by === "owner" ? null : drafter ?? null, settings);
  if ("error" in checked) return { error: checked.error! };
  const agent = await createVillager(checked.value);
  await db
    .update(hireRequests)
    .set({ status: "hired", agentId: agent.id, draft: checked.value, decidedBy: by, decidedAt: new Date() })
    .where(eq(hireRequests.id, request.id));
  if (by === "mayor") await tellOwner(`${agent.name} joined the village`, `Hired by the Mayor (hiring is set to automatic). ${agent.role}, daily budget $${agent.dailyBudgetUsd ?? "—"}.`);
  return { agent };
}

export async function decline(requestId: number): Promise<{ ok: true } | { error: string }> {
  const [request] = await db.select().from(hireRequests).where(eq(hireRequests.id, requestId));
  if (!request) return { error: "no such hire request." };
  if (!["interviewing", "awaiting_owner"].includes(request.status)) return { error: `that request is already ${request.status.replace("_", " ")}.` };
  await db.update(hireRequests).set({ status: "declined", decidedBy: "owner", decidedAt: new Date() }).where(eq(hireRequests.id, requestId));
  return { ok: true };
}

export async function listHireRequests(limit = 30) {
  const rows = sqlite
    .prepare("SELECT id FROM hire_requests ORDER BY CASE WHEN status IN ('interviewing','awaiting_owner') THEN 0 ELSE 1 END, id DESC LIMIT ?")
    .all(limit) as Array<{ id: number }>;
  if (!rows.length) return [];
  const found = await db.select().from(hireRequests).where(inArray(hireRequests.id, rows.map((r) => r.id)));
  return rows.map((r) => found.find((f) => f.id === r.id)!);
}
