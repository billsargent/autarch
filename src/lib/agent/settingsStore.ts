import { db } from "@/db";
import { agentSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_ENABLED_TOOLS, DEFAULT_WORKSPACE_DIR, PROJECT_ROOT } from "./config";

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
async function ensureMessagingEnabled(row: AgentSettingsRow): Promise<AgentSettingsRow> {
  if (messagingEnabled) return row;
  messagingEnabled = true;
  const enabled = (row.enabledTools as string[]) || [];
  if (enabled.includes("post_message")) return row;
  const next = [...enabled, "post_message"];
  const updated = await db
    .update(agentSettings)
    .set({ enabledTools: next, updatedAt: new Date() })
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
    cachedId = row.id;
    migrateSkillsDirOnce(row.workspaceDir);
    return ensureMessagingEnabled(row);
  }
  const inserted = await db
    .insert(agentSettings)
    .values({
      workspaceDir: DEFAULT_WORKSPACE_DIR,
      enabledTools: DEFAULT_ENABLED_TOOLS,
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
