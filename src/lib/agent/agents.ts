import { db, sqlite } from "@/db";
import { agents } from "@/db/schema";
import { asc, eq, ne } from "drizzle-orm";
import { getSettings, type AgentSettingsRow } from "./settingsStore";
import { isCharacterKey, VILLAGER_COLORS } from "./villagerLooks";
import { ABANDONED_AFTER_MS } from "./turnLock";
import { isMayorTool } from "./mayorTools";

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
      .prepare("INSERT INTO agents (name, role, persona, character, color, home, is_mayor) VALUES (?, 'Mayor', ?, 'master', ?, '', 1)")
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
// The Mayor's tools are his alone (#58).
export function effectiveTools(agent: AgentRow, settings: AgentSettingsRow): string[] {
  const town = ((settings.enabledTools as string[]) || []).filter((t) => agent.isMayor || !isMayorTool(t));
  const own = agent.enabledTools as string[] | null;
  return own ? town.filter((t) => own.includes(t)) : town;
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
}

type Clean = Partial<Pick<AgentRow, "name" | "role" | "persona" | "character" | "color" | "model" | "enabledTools" | "dailyBudgetUsd" | "maxActionsPerHour" | "status">>;

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
