import { NextResponse } from "next/server";
import { getSettings, updateSettings, type AgentSettingsRow } from "@/lib/agent/settingsStore";
import { isDeepSeekConfigured } from "@/lib/agent/deepseekClient";
import { validateSettingsPatch } from "@/lib/agent/settingsValidation";
import {
  ALL_TOOL_DEFINITIONS,
} from "@/lib/agent/tools";
import {
  PROTECTED_PACKAGES,
  PROTECTED_SERVICES,
  PROTECTED_PROCESS_NAMES,
  HARD_PROTECTED_PATHS,
} from "@/lib/agent/config";

// Settings as the browser may see them: never the raw API key (#8).
function publicSettings(settings: AgentSettingsRow) {
  const { apiKey, ...safeSettings } = settings;
  return {
    ...safeSettings,
    apiKeySet: Boolean(apiKey),
    deepseekModels: (settings.deepseekModels as string[]) || [],
  };
}

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    settings: publicSettings(settings),
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
  const updated = await updateSettings(checked.patch as Partial<AgentSettingsRow>);
  return NextResponse.json({ settings: publicSettings(updated) });
}
