import { db, sqlite } from "@/db";
import { agents, jobs } from "@/db/schema";
import { and, asc, eq, ne } from "drizzle-orm";
import { getSettings, type AgentSettingsRow } from "./settingsStore";
import { mailReaders } from "./mailAccess";
import { isTradeKey } from "./trades";
import { lifeSummary } from "./life";
import { CHARACTER_KEYS, isCharacterKey, VILLAGER_COLORS } from "./villagerLooks";
import { ABANDONED_AFTER_MS } from "./turnLock";
import { tierAllows } from "./mayorTools";

// The villagers (#55). The Mayor is the first one: on an install from before
// villagers existed, he is made from the old single agent's name and
// personality, and everything that agent owned becomes his.

export type AgentRow = typeof agents.$inferSelect;

const OWNED_TABLES = ["conversations", "jobs", "work_sessions", "tool_executions", "journal_entries", "notifications"];

let mayorId: number | null = null;

// The Mayor, created on first use. Rows with no owner (made before villagers
// existed, or by old code paths) are his; goals stay unowned: town goals.
export async function ensureMayor(): Promise<AgentRow> {
  if (mayorId !== null) {
    const [row] = await db.select().from(agents).where(eq(agents.id, mayorId));
    if (row) return row;
  }
  const existing = await db.select().from(agents).where(eq(agents.isMayor, true)).orderBy(asc(agents.id)).limit(1);
  if (existing.length) {
    mayorId = existing[0].id;
    return existing[0];
  }
  const settings = await getSettings();
  const created = sqlite.transaction(() => {
    const again = sqlite.prepare("SELECT id FROM agents WHERE is_mayor = 1 ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (again) return again.id;
    const info = sqlite
      .prepare("INSERT INTO agents (name, role, persona, character, color, home, is_mayor, tier) VALUES (?, 'Mayor', ?, 'master', ?, '', 1, 'mayor')")
      .run(settings.agentName === "Root" ? "Mayor" : settings.agentName, settings.persona ?? null, VILLAGER_COLORS[0]);
    const id = Number(info.lastInsertRowid);
    for (const t of OWNED_TABLES) sqlite.prepare(`UPDATE ${t} SET agent_id = ? WHERE agent_id IS NULL`).run(id);
    return id;
  }).immediate();
  mayorId = created;
  const [row] = await db.select().from(agents).where(eq(agents.id, created));
  return row;
}

export async function getAgent(id: number | null | undefined): Promise<AgentRow> {
  if (id) {
    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    if (row) return row;
  }
  return ensureMayor();
}

// Everyone still living in the village (paused villagers included).
export async function listVillagers(): Promise<AgentRow[]> {
  await ensureMayor();
  return db.select().from(agents).where(ne(agents.status, "dismissed")).orderBy(asc(agents.id));
}

// The tools a villager may use: its own list, but never beyond the town's tool
// policy (docs/town-charter.md: a villager never gets more than the town allows).
// The Mayor's tools are his alone (#58), and workers can't hire (#99).
export function effectiveTools(agent: AgentRow, settings: AgentSettingsRow): string[] {
  const tier = agent.isMayor ? "mayor" : agent.tier === "mayor" ? "director" : agent.tier;
  const town = ((settings.enabledTools as string[]) || []).filter((t) => tierAllows(tier, t));
  const own = agent.enabledTools as string[] | null;
  const tools = (own ? town.filter((t) => own.includes(t)) : town).filter((t) => t !== "read_email");
  // The owner's inbox goes only to the villagers they picked (#124).
  return mailReaders().includes(agent.id) ? [...tools, "read_email"] : tools;
}

export function agentModel(agent: AgentRow, settings: AgentSettingsRow): string {
  return agent.model?.trim() || settings.modelName;
}

// "Old Tom" → "old-tom": the villager's home folder name.
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "villager"
  );
}

// --- validation for the villagers API ------------------------------------------

export interface AgentInput {
  name?: unknown;
  role?: unknown;
  persona?: unknown;
  character?: unknown;
  color?: unknown;
  model?: unknown;
  enabledTools?: unknown;
  dailyBudgetUsd?: unknown;
  maxActionsPerHour?: unknown;
  status?: unknown;
  tier?: unknown;
  area?: unknown;
  managerId?: unknown;
  providerId?: unknown;
  trade?: unknown;
  lifeBalance?: unknown;
  workShare?: unknown;
}

type Clean = Partial<Pick<AgentRow, "name" | "role" | "persona" | "character" | "color" | "model" | "enabledTools" | "dailyBudgetUsd" | "maxActionsPerHour" | "status" | "tier" | "area" | "managerId" | "providerId" | "trade" | "lifeBalance" | "workShare">>;

// Checks a create/update body. Returns the clean fields, or the first problem
// as "field: reason" (the same shape as settings errors, so forms can place it).
export function validateAgentInput(input: AgentInput, toolNames: readonly string[], creating: boolean): { ok: true; value: Clean } | { ok: false; error: string } {
  const out: Clean = {};
  const has = (k: keyof AgentInput) => k in input && input[k] !== undefined;
  const text = (k: keyof AgentInput, max: number, min = 0): string | null | { error: string } => {
    const v = input[k];
    if (v === null || v === undefined || v === "") return min > 0 ? { error: `${k}: is required.` } : null;
    if (typeof v !== "string") return { error: `${k}: must be text.` };
    const t = v.trim();
    if (t.length < min) return { error: `${k}: is required.` };
    if (t.length > max) return { error: `${k}: must be at most ${max} characters.` };
    return t || null;
  };
  const num = (k: keyof AgentInput, min: number, max: number, int: boolean): number | null | { error: string } => {
    const v = input[k];
    if (v === null || v === "") return null;
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (!Number.isFinite(n)) return { error: `${k}: must be a number.` };
    if (int && !Number.isInteger(n)) return { error: `${k}: must be a whole number.` };
    if (n < min || n > max) return { error: `${k}: must be between ${min} and ${max}.` };
    return n;
  };
  const isErr = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;

  if (creating || has("name")) {
    const v = text("name", 40, 1);
    if (isErr(v)) return { ok: false, error: v.error };
    out.name = v!;
  }
  if (has("role")) {
    const v = text("role", 40);
    if (isErr(v)) return { ok: false, error: v.error };
    out.role = v || "Villager";
  }
  if (has("persona")) {
    const v = text("persona", 4000);
    if (isErr(v)) return { ok: false, error: v.error };
    out.persona = v;
  }
  if (has("trade")) {
    if (input.trade !== null && !isTradeKey(input.trade)) return { ok: false, error: "trade: isn't one of the village's trades." };
    out.trade = (input.trade as string | null) ?? null;
  }
  if (has("lifeBalance")) {
    if (input.lifeBalance !== null && !["idle", "hours", "balanced"].includes(input.lifeBalance as string)) return { ok: false, error: "lifeBalance: idle, hours, balanced, or empty for the town's." };
    out.lifeBalance = (input.lifeBalance as "idle" | "hours" | "balanced" | null) ?? null;
  }
  if (has("workShare")) {
    const v = num("workShare", 0, 100, true);
    if (isErr(v)) return { ok: false, error: v.error };
    out.workShare = v;
  }
  if (has("character")) {
    if (!isCharacterKey(input.character)) return { ok: false, error: "character: isn't one of the village's looks." };
    out.character = input.character;
  }
  if (has("color")) {
    if (typeof input.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(input.color)) return { ok: false, error: "color: must look like #a1b2c3." };
    out.color = input.color;
  }
  if (has("model")) {
    const v = text("model", 200);
    if (isErr(v)) return { ok: false, error: v.error };
    out.model = v;
  }
  if (has("enabledTools")) {
    const v = input.enabledTools;
    if (v === null) out.enabledTools = null;
    else if (!Array.isArray(v) || !v.every((t) => typeof t === "string" && toolNames.includes(t))) {
      return { ok: false, error: "enabledTools: must be a list of known tools." };
    } else out.enabledTools = v;
  }
  if (has("dailyBudgetUsd")) {
    const v = num("dailyBudgetUsd", 0, 1000, false);
    if (isErr(v)) return { ok: false, error: v.error };
    out.dailyBudgetUsd = v;
  }
  if (has("maxActionsPerHour")) {
    const v = num("maxActionsPerHour", 1, 10000, true);
    if (isErr(v)) return { ok: false, error: v.error };
    out.maxActionsPerHour = v;
  }
  if (has("status")) {
    if (input.status !== "active" && input.status !== "paused") return { ok: false, error: "status: must be active or paused." };
    out.status = input.status;
  }
  // There is one Mayor; everyone else is a director or a worker (#99).
  if (has("tier")) {
    if (input.tier !== "director" && input.tier !== "worker") return { ok: false, error: "tier: must be director or worker." };
    out.tier = input.tier;
  }
  if (has("area")) {
    const v = text("area", 60);
    if (isErr(v)) return { ok: false, error: v.error };
    out.area = v;
  }
  if (has("providerId")) {
    const v = input.providerId;
    if (v === null || v === "") out.providerId = null;
    else if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return { ok: false, error: "providerId: must be a provider." };
    else out.providerId = v;
  }
  if (has("managerId")) {
    const v = input.managerId;
    if (v === null || v === "") out.managerId = null;
    else if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return { ok: false, error: "managerId: must be a villager." };
    else out.managerId = v;
  }
  return { ok: true, value: out };
}

// --- live state -------------------------------------------------------------------

export function startOfToday(now = new Date()): number {
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
}

// What a villager has spent today (USD), counting the turn in progress.
export function spentToday(agentId: number, now = new Date()): number {
  const row = sqlite
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM work_sessions WHERE agent_id = ? AND started_at >= ?")
    .get(agentId, startOfToday(now)) as { c: number };
  return row.c;
}

// What the whole village has spent today (USD).
export function townSpentToday(now = new Date()): number {
  const row = sqlite.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM work_sessions WHERE started_at >= ?").get(startOfToday(now)) as { c: number };
  return row.c;
}

export interface VillagerState {
  working: boolean;
  waiting: number;
  spentToday: number;
  // Their latest conversation, and the last thing they said in any of them.
  focusConversationId: number | null;
  lastSaid: string | null;
  lastSaidAt: number | null;
  // A neighbour they're talking with right now (#57): answering their
  // question, or waiting on their answer.
  talkingWith: number | null;
  // At the town meeting going on now (#81).
  inMeeting: boolean;
  // Has free time (#59): their daydream job is on.
  daydream: boolean;
  // Their village life (#132): trade, what they're doing, how they feel, friends.
  life: ReturnType<typeof lifeSummary>;
}

// What each villager is up to right now: for the village to draw them.
export function villagerStates(ids: number[], now = new Date()): Map<number, VillagerState> {
  const out = new Map<number, VillagerState>();
  const today = startOfToday(now);
  // Villager-to-villager threads being answered right now: both sides are
  // talking with each other.
  const fresh = Math.floor((now.getTime() - ABANDONED_AFTER_MS) / 1000);
  const threads = sqlite
    .prepare(
      `SELECT s.agent_id AS answering, c.partner_agent_id AS asking FROM work_sessions s JOIN conversations c ON c.id = s.conversation_id
       WHERE s.status = 'running' AND s.trigger = 'message' AND c.partner_agent_id IS NOT NULL AND COALESCE(s.heartbeat_at, s.started_at) >= ?`,
    )
    .all(fresh) as Array<{ answering: number; asking: number }>;
  const partner = new Map<number, number>();
  for (const t of threads) {
    partner.set(t.answering, t.asking);
    partner.set(t.asking, t.answering);
  }
  const meeting = sqlite.prepare("SELECT participants FROM meetings WHERE status = 'open' ORDER BY id LIMIT 1").get() as { participants: string } | undefined;
  const attending = new Set<number>(meeting ? JSON.parse(meeting.participants) : []);
  for (const id of ids) {
    // A running turn whose heartbeat went quiet belonged to a process that
    // stopped; it doesn't count (the turn lock lets go of it too).
    const working = Boolean(
      sqlite
        .prepare("SELECT 1 FROM work_sessions WHERE agent_id = ? AND status = 'running' AND COALESCE(heartbeat_at, started_at) >= ? LIMIT 1")
        .get(id, Math.floor((now.getTime() - ABANDONED_AFTER_MS) / 1000)),
    );
    const waiting = (sqlite.prepare("SELECT COUNT(*) AS n FROM tool_executions WHERE agent_id = ? AND status = 'awaiting_approval'").get(id) as { n: number }).n;
    const spent = (sqlite.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM work_sessions WHERE agent_id = ? AND started_at >= ?").get(id, today) as { c: number }).c;
    const focus = sqlite
      .prepare(
        `SELECT c.id FROM conversations c
         LEFT JOIN work_sessions s ON s.conversation_id = c.id AND s.status = 'running'
         WHERE c.agent_id = ? ORDER BY (s.id IS NOT NULL) DESC, c.updated_at DESC LIMIT 1`,
      )
      .get(id) as { id: number } | undefined;
    const said = sqlite
      .prepare(
        `SELECT m.content, m.created_at FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.agent_id = ? AND m.role = 'assistant' AND TRIM(COALESCE(m.content, '')) <> ''
         ORDER BY m.id DESC LIMIT 1`,
      )
      .get(id) as { content: string; created_at: number } | undefined;
    out.set(id, {
      working,
      waiting,
      spentToday: spent,
      focusConversationId: focus?.id ?? null,
      lastSaid: said?.content.trim() ?? null,
      lastSaidAt: said ? said.created_at * 1000 : null,
      talkingWith: partner.get(id) ?? null,
      inMeeting: attending.has(id),
      life: lifeSummary(id),
      daydream: Boolean(sqlite.prepare("SELECT 1 FROM jobs WHERE agent_id = ? AND kind = 'daydream' AND enabled = 1").get(id)),
    });
  }
  return out;
}

// --- budgets (#60) ------------------------------------------------------------------

// A turn refused (or stopped) because a daily budget is spent.
export class BudgetError extends Error {
  status = 429;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

// Why this villager can't spend any more today, or null if they can.
export function budgetProblem(agent: AgentRow, settings: AgentSettingsRow, now = new Date()): string | null {
  if (agent.dailyBudgetUsd != null) {
    const spent = spentToday(agent.id, now);
    if (spent >= agent.dailyBudgetUsd) {
      return `${agent.name} has spent today's budget (${usd(spent)} of ${usd(agent.dailyBudgetUsd)}). It starts again at midnight, or you can raise it in the Mayor's ledger.`;
    }
  }
  if (settings.townDailyBudgetUsd != null) {
    const spent = townSpentToday(now);
    if (spent >= settings.townDailyBudgetUsd) {
      return `The village has spent today's budget (${usd(spent)} of ${usd(settings.townDailyBudgetUsd)}). It starts again at midnight, or you can raise it in the Mayor's ledger.`;
    }
  }
  return null;
}

// Tool actions in the last hour: one villager's, or the whole village's. The
// call being checked is already recorded (as it starts), so it's left out.
export function actionsInLastHour(agentId?: number, excludeId = 0, now = Date.now()): number {
  const since = Math.floor(now / 1000) - 3600;
  const row = (
    agentId
      ? sqlite
          .prepare("SELECT COUNT(*) AS n FROM tool_executions WHERE agent_id = ? AND requested_at >= ? AND status IN ('success', 'approved') AND id <> ?")
          .get(agentId, since, excludeId)
      : sqlite
          .prepare("SELECT COUNT(*) AS n FROM tool_executions WHERE requested_at >= ? AND status IN ('success', 'approved') AND id <> ?")
          .get(since, excludeId)
  ) as { n: number };
  return row.n;
}

// --- making a villager -------------------------------------------------------------

export type NewVillager = ReturnType<typeof validateAgentInput> extends infer R ? (R extends { ok: true; value: infer V } ? V : never) : never;

// Adds a villager from checked fields (validateAgentInput): a home folder of
// their own, and a look and colour nobody else has yet if possible. Used by
// the owner's Villagers page and by hiring (#99).
export async function createVillager(value: NewVillager): Promise<AgentRow> {
  const everyone = await db.select().from(agents);
  const homes = new Set(everyone.map((a) => a.home));
  const base = `villagers/${slugify(value.name!)}`;
  let home = base;
  for (let i = 2; homes.has(home); i++) home = `${base}-${i}`;
  const living = everyone.filter((a) => a.status !== "dismissed");
  const usedLooks = new Set(living.map((a) => a.character));
  const usedColors = new Set(living.map((a) => a.color));
  const [created] = await db
    .insert(agents)
    .values({
      name: value.name!,
      role: value.role ?? "Villager",
      persona: value.persona ?? null,
      character: value.character ?? CHARACTER_KEYS.find((c) => c !== "master" && !usedLooks.has(c)) ?? "villager",
      color: value.color ?? VILLAGER_COLORS.find((c) => !usedColors.has(c)) ?? VILLAGER_COLORS[1],
      model: value.model ?? null,
      enabledTools: value.enabledTools ?? null,
      dailyBudgetUsd: value.dailyBudgetUsd ?? null,
      maxActionsPerHour: value.maxActionsPerHour ?? null,
      tier: value.tier ?? "director",
      area: value.area ?? null,
      managerId: value.managerId ?? null,
      providerId: value.providerId ?? null,
      home,
    })
    .returning();
  return created;
}

// How many live in the village now (the Mayor included).
export function population(): number {
  return (sqlite.prepare("SELECT COUNT(*) AS n FROM agents WHERE status <> 'dismissed'").get() as { n: number }).n;
}

// --- village life (#59, #133) -----------------------------------------------------------------

export const DAYDREAM_EVERY_MINUTES = 240;
export const DAYDREAM_MINUTES = 5;

// Switches a villager's village life on or off (#133): a short life window
// once a day, on their own budget; the day split decides when (#130). The job
// kind is still "daydream", from when this was free time (#59).
export async function setDaydream(agent: AgentRow, on: boolean) {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.agentId, agent.id), eq(jobs.kind, "daydream"))).limit(1);
  if (job) {
    await db
      .update(jobs)
      .set({ enabled: on, ...(on ? { nextRunAt: new Date(Date.now() + 30 * 60_000) } : {}), updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
  } else if (on) {
    await db.insert(jobs).values({
      name: `${agent.name}'s village life`,
      instruction: "Village life: their own time in the village, once a day, with village tools only (#133).",
      kind: "daydream",
      intervalMinutes: DAYDREAM_EVERY_MINUTES,
      maxDurationMinutes: DAYDREAM_MINUTES,
      enabled: true,
      agentId: agent.id,
      nextRunAt: new Date(Date.now() + 30 * 60_000),
    });
  }
}

// --- budget letters ------------------------------------------------------------------

// A letter to the owner when the village reaches 80% of its daily budget, and
// another when it's all spent (once each a day). Called after each session.
export async function budgetAlerts(now = new Date()): Promise<string[]> {
  const settings = await getSettings();
  const cap = settings.townDailyBudgetUsd;
  if (cap == null || cap <= 0) return [];
  const spent = townSpentToday(now);
  const sent: string[] = [];
  for (const [share, title] of [
    [1, "The village has spent today's budget"],
    [0.8, "The village has spent 80% of today's budget"],
  ] as const) {
    if (spent < cap * share) continue;
    const already = sqlite.prepare("SELECT 1 FROM notifications WHERE kind = 'budget' AND title = ? AND created_at >= ?").get(title, startOfToday(now));
    if (!already) {
      sqlite
        .prepare("INSERT INTO notifications (kind, title, body, severity, source) VALUES ('budget', ?, ?, ?, 'The vault')")
        .run(title, `$${spent.toFixed(2)} of $${cap.toFixed(2)} so far today.${share === 1 ? " Everything stops until midnight, unless you raise the budget (Mayor's ledger → Limits)." : ""}`, share === 1 ? "critical" : "warning");
      sent.push(title);
    }
    break; // only the highest threshold reached
  }
  return sent;
}
