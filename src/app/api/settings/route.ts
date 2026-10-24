import { NextResponse } from "next/server";
import { getSettings, updateSettings, type AgentSettingsRow } from "@/lib/agent/settingsStore";
import { isDeepSeekConfigured } from "@/lib/agent/deepseekClient";
import { validateSettingsPatch } from "@/lib/agent/settingsValidation";
import { ensureMayor } from "@/lib/agent/agents";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  ALL_TOOL_DEFINITIONS,
} from "@/lib/agent/tools";
import {
  PROTECTED_PACKAGES,
  PROTECTED_SERVICES,
  PROTECTED_PROCESS_NAMES,
  HARD_PROTECTED_PATHS,
} from "@/lib/agent/config";

// Settings as the browser may see them: never the raw API key (#8). The
// agent's name and personality are the Mayor's now that there are villagers
// (#55), so older screens that edit "the agent" edit him.
async function publicSettings(settings: AgentSettingsRow) {
  const { apiKey, ...safeSettings } = settings;
  const mayor = await ensureMayor();
  return {
    ...safeSettings,
    agentName: mayor.name,
    persona: mayor.persona,
    apiKeySet: Boolean(apiKey),
    deepseekModels: (settings.deepseekModels as string[]) || [],
  };
}

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    settings: await publicSettings(settings),
    deepSeekConfigured: isDeepSeekConfigured(settings),
    availableTools: ALL_TOOL_DEFINITIONS.map((t) => ({ name: t.function.name, description: t.function.description })),
    hardSafeguards: {
      protectedPaths: HARD_PROTECTED_PATHS,
      protectedPackages: PROTECTED_PACKAGES,
      protectedServices: PROTECTED_SERVICES,
      protectedProcesses: PROTECTED_PROCESS_NAMES,
    },
  });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const allowedKeys = [
    "autonomyMode",
    "modelName",
    "maxAgentSteps",
    "maxActionsPerHour",
    "commandTimeoutSec",
    "toolRetries",
    "workspaceDir",
    "enabledTools",
    "extraProtectedPaths",
    "systemPromptExtra",
    // Custom prompts from Settings → System prompts. These were missing, so
    // the page showed them as saved while the server dropped them.
    "staticCorePrompt",
    "persona",
    "workWindowPrompt",
    "focusedChatPrompt",
    "truncationMessage",
    "allowNetworkFetch",
    "agentName",
    "apiKey",
    "apiBaseUrl",
    "paused",
    "humanAtKeyboard",
    "chatMode",
    "minGapMinutes",
    "maxSessionsPerDay",
    "maxSessionMinutes",
    "inputPricePerMTok",
    "outputPricePerMTok",
    "unrestrictedMode",
    "allowSecretReads",
    "allowFrameworkMutations",
    "allowDestructiveShell",
    "allowProtectedSystemOps",
    "maxContextTokens",
    "compactTargetTokens",
    "autoCompact",
    "thinkingEnabled",
    "reasoningEffort",
    "maxOutputTokens",
    "cacheHitInputPricePerMTok",
    "townDailyBudgetUsd",
    "bedtime",
    "wakeTime",
    "hiringMode",
    "maxPopulation",
    "meetingCostCapUsd",
    "awayUntil",
    "awaySpendCapUsd",
    "voteCostCapUsd",
  ];
  const patch: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in body) patch[key] = body[key];
  }
  // Server-side guard for the dangerous switches — the UI's window.confirm is
  // not a security boundary, so the API requires an explicit confirm:true.
  if ((patch.unrestrictedMode === true || patch.autonomyMode === "unrestricted") && body.confirm !== true) {
    return NextResponse.json({ error: "Enabling unrestricted mode requires confirm: true." }, { status: 400 });
  }
  const checked = validateSettingsPatch(patch, ALL_TOOL_DEFINITIONS.map((t) => t.function.name));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  // Going away starts the away-mode spend count afresh (#102).
  if (checked.patch.awayUntil) checked.patch.awayStartedAt = new Date();
  const updated = await updateSettings(checked.patch as Partial<AgentSettingsRow>);
  const clean = checked.patch as Partial<AgentSettingsRow>;
  if ("agentName" in clean || "persona" in clean) {
    const mayor = await ensureMayor();
    await db
      .update(agents)
      .set({
        ...("agentName" in clean ? { name: clean.agentName } : {}),
        ...("persona" in clean ? { persona: clean.persona ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(agents.id, mayor.id));
  }
  return NextResponse.json({ settings: await publicSettings(updated) });
}
