import { NextResponse } from "next/server";
import { getSettings, updateSettings, type AgentSettingsRow } from "@/lib/agent/settingsStore";
import { isDeepSeekConfigured } from "@/lib/agent/deepseekClient";
import {
  ALL_TOOL_DEFINITIONS,
} from "@/lib/agent/tools";
import {
  PROTECTED_PACKAGES,
  PROTECTED_SERVICES,
  PROTECTED_PROCESS_NAMES,
  HARD_PROTECTED_PATHS,
} from "@/lib/agent/config";

export async function GET() {
  const settings = await getSettings();
  // Never return the raw API key to the browser.
  const { apiKey, ...safeSettings } = settings;
  return NextResponse.json({
    settings: {
      ...safeSettings,
      apiKeySet: Boolean(apiKey),
      deepseekModels: (settings.deepseekModels as string[]) || [],
    },
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
  const updated = await updateSettings(patch as Partial<AgentSettingsRow>);
  return NextResponse.json({ settings: updated });
}
