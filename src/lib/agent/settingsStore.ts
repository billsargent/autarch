import { db, sqlite } from "@/db";
import { agentSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_ENABLED_TOOLS, DEFAULT_WORKSPACE_DIR, PROJECT_ROOT } from "./config";
import { normalizeWorkspace } from "./settingsValidation";
import { HIRING_TOOLS, MAYOR_TOOLS } from "./mayorTools";

export type AgentSettingsRow = typeof agentSettings.$inferSelect;

let cachedId: number | null = null;
let skillsMigrated = false;
let messagingEnabled = false;

// One-time move of the old framework-level data/skills folder into the agent's
// workspace (skills now live inside the workspace so everything stays together).
function migrateSkillsDirOnce(workspaceDir: string) {
  if (skillsMigrated) return;
  skillsMigrated = true;
  try {
    const src = path.join(PROJECT_ROOT, "data", "skills");
    const dest = path.join(workspaceDir, "skills");
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
    }
  } catch {
    // Best-effort; the agent will just start fresh in the workspace.
  }
}

// The async-messaging tool is low-risk + rate-limited; auto-enable it once on
// installs created before it existed so the agent can talk to the human in a
// session out of the box.
// Tools added after an install was set up are offered to its tool policy once
// (switched on), and remembered, so if the owner later switches one off it
// stays off.
export const DEFAULT_TOWN_BUDGET_USD = 2;

const NEW_TOOLS_TO_OFFER = ["message_owner", "ask_villager", ...MAYOR_TOOLS, ...HIRING_TOOLS, "note_about", "propose_idea", "save_draft", "pin_notice", "write_letter", "read_letters"];
// Village tools every villager should have, even one with a tool list of
// their own: added to those lists once (done_once), so a tool the owner later
// takes off a villager stays off.
const OFFERED_TO_EVERY_VILLAGER = ["write_letter", "read_letters"];

export function offerToEveryVillager(tools: string[]) {
  const everyone = tools.filter((t) => OFFERED_TO_EVERY_VILLAGER.includes(t));
  if (!everyone.length) return;
  const own = sqlite.prepare("SELECT id, enabled_tools AS tools FROM agents WHERE enabled_tools IS NOT NULL").all() as Array<{ id: number; tools: string }>;
  for (const a of own) {
    const list = JSON.parse(a.tools) as string[];
    const add = everyone.filter((t) => !list.includes(t));
    if (add.length) sqlite.prepare("UPDATE agents SET enabled_tools = ? WHERE id = ?").run(JSON.stringify([...list, ...add]), a.id);
  }
}

async function ensureMessagingEnabled(row: AgentSettingsRow): Promise<AgentSettingsRow> {
  if (messagingEnabled) return row;
  messagingEnabled = true;
  const offered = new Set((row.offeredTools as string[] | null) ?? []);
  const enabled = (row.enabledTools as string[]) || [];
  if (!sqlite.prepare("SELECT 1 FROM done_once WHERE name = 'letters-172'").get()) {
    offerToEveryVillager(OFFERED_TO_EVERY_VILLAGER);
    sqlite.prepare("INSERT OR IGNORE INTO done_once (name) VALUES ('letters-172')").run();
  }
  const fresh = NEW_TOOLS_TO_OFFER.filter((t) => !offered.has(t));
  if (!fresh.length) return row;
  const next = [...enabled, ...fresh.filter((t) => !enabled.includes(t))];
  const updated = await db
    .update(agentSettings)
    .set({ enabledTools: next, offeredTools: [...offered, ...fresh], updatedAt: new Date() })
    .where(eq(agentSettings.id, row.id))
    .returning();
  return updated[0];
}

export async function getSettings(): Promise<AgentSettingsRow> {
  const rows = await db.select().from(agentSettings).limit(1);
  if (rows.length > 0) {
    const row = rows[0];
    // Auto-migrate installs created before the workspace default became
    // persistent (/tmp is wiped on reboot).
    if (row.workspaceDir === "/tmp/deepseek-agent-workspace") {
      const updated = await db
        .update(agentSettings)
        .set({ workspaceDir: DEFAULT_WORKSPACE_DIR, updatedAt: new Date() })
        .where(eq(agentSettings.id, row.id))
        .returning();
      cachedId = updated[0].id;
      migrateSkillsDirOnce(DEFAULT_WORKSPACE_DIR);
      return ensureMessagingEnabled(updated[0]);
    }
    // On Windows, a workspace written Linux-style (/root/agent-workspace)
    // meant that folder on the app's own drive: write it out as a drive path,
    // the same folder (#157).
    if (process.platform === "win32" && row.workspaceDir.startsWith("/")) {
      const bash = normalizeWorkspace(row.workspaceDir, "win32");
      const dir = bash.startsWith("/") ? path.resolve(row.workspaceDir) : bash;
      const updated = await db.update(agentSettings).set({ workspaceDir: dir, updatedAt: new Date() }).where(eq(agentSettings.id, row.id)).returning();
      cachedId = updated[0].id;
      migrateSkillsDirOnce(dir);
      return ensureMessagingEnabled(updated[0]);
    }
    cachedId = row.id;
    migrateSkillsDirOnce(row.workspaceDir);
    return ensureMessagingEnabled(row);
  }
  const inserted = await db
    .insert(agentSettings)
    .values({
      workspaceDir: DEFAULT_WORKSPACE_DIR,
      enabledTools: DEFAULT_ENABLED_TOOLS,
      // A fresh village starts with a daily budget, so nothing it does on its
      // own can run up a bill before the owner has looked (changeable in Limits).
      townDailyBudgetUsd: DEFAULT_TOWN_BUDGET_USD,
    })
    .returning();
  cachedId = inserted[0].id;
  migrateSkillsDirOnce(DEFAULT_WORKSPACE_DIR);
  return inserted[0];
}

export async function updateSettings(patch: Partial<AgentSettingsRow>): Promise<AgentSettingsRow> {
  const current = await getSettings();
  const { id, updatedAt, ...rest } = current;
  void rest;
  const updated = await db
    .update(agentSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(agentSettings.id, id))
    .returning();
  return updated[0];
}
