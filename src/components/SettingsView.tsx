"use client";

import { useState } from "react";
import { DEFAULT_PERSONA, personaToSave } from "@/lib/agent/persona";
import {
  AUTONOMY_INFO,
  AUTONOMY_MODES,
  UNRESTRICTED_MODE_WARNING,
  UNRESTRICTED_OVERRIDES_WARNING,
  useSettings,
} from "./data/useSettings";

export default function SettingsView() {
  const {
    settings,
    tools,
    hard,
    deepSeekConfigured,
    models,
    saving,
    savedAt,
    saveError,
    save,
    testAndLoadModels: loadModels,
    toggleTool,
    addProtectedPath: addPath,
    removeProtectedPath,
  } = useSettings();
  const [newPath, setNewPath] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelMsg, setModelMsg] = useState<string | null>(null);
  const baseUrl = baseUrlInput ?? settings?.apiBaseUrl ?? "";

  async function testAndLoadModels() {
    setModelLoading(true);
    setModelMsg(null);
    setModelMsg(await loadModels(apiKeyInput, baseUrl));
    setModelLoading(false);
  }

  function addProtectedPath() {
    if (!newPath.trim()) return;
    addPath(newPath);
    setNewPath("");
  }

  if (!settings) {
    return <div className="p-8 text-sm text-neutral-500">Loading settings…</div>;
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl pb-16">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Settings &amp; safeguards</h1>
            <p className="mt-1 text-sm text-neutral-500">Configure autonomy, tools, and limits. Core self-protection rules below can never be disabled here.</p>
          </div>
          {saving ? (
            <span className="text-xs text-neutral-500">saving…</span>
          ) : savedAt ? (
            <span className="text-xs text-emerald-500">saved</span>
          ) : null}
        </div>
        {saveError && <p className="mt-2 text-xs text-red-400">{saveError}</p>}

        {!deepSeekConfigured && !settings.apiKeySet && (
          <div className="mt-4 rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-300">
            <strong>No DeepSeek API key configured.</strong> Enter one below so the agent can talk to the DeepSeek API.
          </div>
        )}

        <section className="mt-6 rounded-xl border p-4 bg-neutral-900">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className={`text-sm font-semibold ${settings.paused ? "text-red-300" : ""}`}>
                {settings.paused ? "⏸ Agent is PAUSED" : "Agent active"}
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                {settings.paused
                  ? "All tool execution and scheduled work is frozen. Chat still works; nothing runs until you resume."
                  : "Tools run per autonomy rules. Use the switch to instantly freeze all agent actions and scheduled jobs."}
              </p>
            </div>
            <button
              onClick={() => save({ paused: !settings.paused })}
              className={`shrink-0 rounded-lg px-4 py-2 text-xs font-bold ${
                settings.paused
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-red-600 text-white hover:bg-red-500"
              }`}
            >
              {settings.paused ? "Resume agent" : "Pause agent"}
            </button>
          </div>
          <div className="mt-4 border-t border-neutral-800 pt-3">
            <ToggleRow
              label="Human at keyboard"
              desc="Tell the agent a human is physically present so it can coordinate interactive tests."
              checked={settings.humanAtKeyboard}
              onToggle={(v) => save({ humanAtKeyboard: v })}
            />
          </div>
          <div className="mt-4 border-t border-neutral-800 pt-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-neutral-300">Default chat mode for new conversations</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Conversation mode answers without tools; agentic mode may use tools for tasks. Each conversation
                  keeps its own mode — switch it from the chat header. Scheduled work is always agentic.
                </p>
              </div>
              <div className="flex shrink-0 rounded-lg border border-neutral-700 bg-neutral-950 p-0.5 text-[11px]">
                <button
                  onClick={() => save({ chatMode: "conversation" })}
                  className={`rounded-md px-3 py-1.5 ${
                    settings.chatMode === "conversation"
                      ? "bg-neutral-700 text-white"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  💬 Conversation
                </button>
                <button
                  onClick={() => save({ chatMode: "agentic" })}
                  className={`rounded-md px-3 py-1.5 ${
                    settings.chatMode === "agentic"
                      ? "bg-neutral-700 text-white"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  🤖 Agentic
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-red-900/50 bg-red-950/10 p-5">
          <h2 className="text-sm font-semibold text-red-200">⚠️ Supervisor overrides</h2>
          <p className="mt-1 text-xs text-neutral-400">
            By default these actions are hard-blocked: reading secrets, modifying this framework&apos;s own files,
            destructive shell commands, and protected system operations. Enabling an override lets the agent{" "}
            <span className="text-neutral-200">request</span> those actions — they still require your explicit
            approval each time and never run automatically.
          </p>

          {(settings.unrestrictedMode ||
            settings.allowSecretReads ||
            settings.allowFrameworkMutations ||
            settings.allowDestructiveShell ||
            settings.allowProtectedSystemOps) && (
            <div className="mt-3 rounded-lg border border-red-700 bg-red-900/30 p-3 text-xs text-red-200">
              <strong>You are responsible for anything the agent does with these enabled.</strong> Destructive or
              sensitive actions STILL require your explicit approval each time.
            </div>
          )}

          <div className="mt-3 space-y-2">
            <ToggleRow
              label="Unrestricted mode"
              desc="Enables every override below at once. Extreme caution."
              checked={settings.unrestrictedMode}
              onToggle={(v) => {
                if (
                  v &&
                  !window.confirm(UNRESTRICTED_OVERRIDES_WARNING)
                ) {
                  return;
                }
                save({ unrestrictedMode: v });
              }}
              danger
            />
            <ToggleRow
              label="Allow reading secrets"
              desc="Lets the agent read .env, .ssh/, id_rsa, credentials.json, etc."
              checked={settings.allowSecretReads}
              onToggle={(v) => save({ allowSecretReads: v })}
            />
            <ToggleRow
              label="Allow modifying framework files"
              desc="Writes/deletes to node_modules, .git, .env, src/db, package.json, etc."
              checked={settings.allowFrameworkMutations}
              onToggle={(v) => save({ allowFrameworkMutations: v })}
            />
            <ToggleRow
              label="Allow destructive shell commands"
              desc="rm -rf /, mkfs, fork bombs, killing PID 1, chmod -R 777 /, etc."
              checked={settings.allowDestructiveShell}
              onToggle={(v) => save({ allowDestructiveShell: v })}
            />
            <ToggleRow
              label="Allow protected system ops"
              desc="Removing core packages, stopping protected services, killing protected processes."
              checked={settings.allowProtectedSystemOps}
              onToggle={(v) => save({ allowProtectedSystemOps: v })}
            />
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold">Identity &amp; model</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <label className="text-xs text-neutral-400">
              Agent name
              <input
                defaultValue={settings.agentName}
                onBlur={(e) => save({ agentName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none"
              />
            </label>
            <label className="text-xs text-neutral-400">
              API base URL
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="https://api.deepseek.com"
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none"
              />
            </label>
          </div>
          <label className="mt-3 block text-xs text-neutral-400">
            Personality
            <textarea
              key={`persona:${settings.persona ?? ""}`}
              defaultValue={settings.persona ?? DEFAULT_PERSONA}
              onBlur={(e) => {
                const v = personaToSave(e.target.value);
                if (v !== (settings.persona ?? null)) save({ persona: v });
              }}
              rows={4}
              className="mt-1 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none"
            />
            <span className="mt-1 block text-[10px] text-neutral-600">Who the agent is, in your words. Edit or add to the default; clear it to go back.</span>
          </label>
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
            <p className="text-xs text-neutral-400">
              DeepSeek API key:{" "}
              <span className={settings.apiKeySet ? "text-emerald-500" : "text-red-400"}>
                {settings.apiKeySet ? "configured" : "not set"}
              </span>
            </p>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={settings.apiKeySet ? "Enter a new key to replace it…" : "sk-…"}
                className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
              <button
                onClick={testAndLoadModels}
                disabled={modelLoading}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {modelLoading ? "Testing…" : "Test & load models"}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-neutral-600">
              Saves the key on this machine (masked in the UI) and fetches available model names from the API.
            </p>
            {modelMsg && <p className="mt-1 text-[11px] text-neutral-400">{modelMsg}</p>}
          </div>
          <label className="mt-3 block text-xs text-neutral-400">
            Model
            <ModelInput value={settings.modelName} models={models} onSave={(modelName) => save({ modelName })} />
            <span className="mt-1 block text-[10px] text-neutral-600">
              {models.length
                ? "Pick one of the models loaded from the API, or type any other model name."
                : "Type a model name, or click 'Test & load models' to list the ones the API offers."}
            </span>
          </label>
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-neutral-300">Thinking mode (chain-of-thought)</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  DeepSeek runs CoT by default at high effort, spending output tokens on every step. Lower effort or
                  disabling it cuts cost.
                </p>
              </div>
              <button
                onClick={() => save({ thinkingEnabled: !settings.thinkingEnabled })}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
                  settings.thinkingEnabled ? "bg-cyan-600 text-white" : "bg-neutral-700 text-neutral-300"
                }`}
              >
                {settings.thinkingEnabled ? "ON" : "OFF"}
              </button>
            </div>
            {settings.thinkingEnabled && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <label className="text-xs text-neutral-400">
                  Reasoning effort
                  <select
                    value={settings.reasoningEffort}
                    onChange={(e) => save({ reasoningEffort: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none"
                  >
                    <option value="low">low (cheapest)</option>
                    <option value="high">high</option>
                    <option value="max">max</option>
                  </select>
                  <span className="mt-1 block text-[10px] text-neutral-600">On v4-flash, low maps to low effort.</span>
                </label>
                <label className="text-xs text-neutral-400">
                  Max output tokens / step
                  <input
                    type="number"
                    step="100"
                    defaultValue={settings.maxOutputTokens}
                    onBlur={(e) => save({ maxOutputTokens: Number(e.target.value) || 256 })}
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none"
                  />
                  <span className="mt-1 block text-[10px] text-neutral-600">Caps reasoning + answer per model call.</span>
                </label>
              </div>
            )}
          </div>
          <label className="mt-3 block text-xs text-neutral-400">
            Extra system prompt instructions (optional)
            <textarea
              defaultValue={settings.systemPromptExtra || ""}
              onBlur={(e) => save({ systemPromptExtra: e.target.value })}
              rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none"
              placeholder="e.g. Focus on Python tooling this week. Don't install anything over 500MB."
            />
          </label>
        </section>

        <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold">System prompts</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Customize the prompts sent to the model. Leave blank to use built-in defaults. Use <code className="text-neutral-400">{`{name}`}</code> for the agent name.
          </p>
          <div className="mt-3 space-y-3">
            <label className="block text-xs text-neutral-400">
              Static core (identity, environment, guardrails, behavior, output format, cost awareness)
              <textarea
                defaultValue={settings.staticCorePrompt || ""}
                onBlur={(e) => save({ staticCorePrompt: e.target.value || null })}
                rows={6}
                className="mt-1 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 font-mono text-[11px] text-neutral-100 outline-none"
                placeholder="(uses built-in default — identity, guardrails, behavior, formatting rules, cost + notification policy)"
              />
              <span className="mt-1 block text-[10px] text-neutral-600">{settings.staticCorePrompt ? `${settings.staticCorePrompt.length} chars` : "using default"}</span>
            </label>
            <label className="block text-xs text-neutral-400">
              Work window prompt (scheduled jobs)
              <textarea
                defaultValue={settings.workWindowPrompt || ""}
                onBlur={(e) => save({ workWindowPrompt: e.target.value || null })}
                rows={4}
                className="mt-1 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 font-mono text-[11px] text-neutral-100 outline-none"
                placeholder="(uses built-in default — includes step/time budget and job details)"
              />
              <span className="mt-1 block text-[10px] text-neutral-600">{settings.workWindowPrompt ? `${settings.workWindowPrompt.length} chars` : "using default"}</span>
            </label>
            <label className="block text-xs text-neutral-400">
              Focused chat prompt
              <textarea
                defaultValue={settings.focusedChatPrompt || ""}
                onBlur={(e) => save({ focusedChatPrompt: e.target.value || null })}
                rows={3}
                className="mt-1 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 font-mono text-[11px] text-neutral-100 outline-none"
                placeholder="(uses built-in default — answer questions, don't drift into jobs/goals)"
              />
              <span className="mt-1 block text-[10px] text-neutral-600">{settings.focusedChatPrompt ? `${settings.focusedChatPrompt.length} chars` : "using default"}</span>
            </label>
            <label className="block text-xs text-neutral-400">
              Truncation message (shown when step limit is reached)
              <textarea
                defaultValue={settings.truncationMessage || ""}
                onBlur={(e) => save({ truncationMessage: e.target.value || null })}
                rows={2}
                className="mt-1 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 font-mono text-[11px] text-neutral-100 outline-none"
                placeholder="(uses built-in default — different for chat vs work windows)"
              />
              <span className="mt-1 block text-[10px] text-neutral-600">{settings.truncationMessage ? `${settings.truncationMessage.length} chars` : "using default"}</span>
            </label>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold">Autonomy mode</h2>
          <div className="mt-3 space-y-2">
            {AUTONOMY_MODES.map((mode) => (
              <label
                key={mode}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs ${
                  settings.autonomyMode === mode
                    ? mode === "unrestricted"
                      ? "border-red-700 bg-red-950/30"
                      : "border-blue-600 bg-blue-950/20"
                    : "border-neutral-800"
                }`}
              >
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={settings.autonomyMode === mode}
                  onChange={() => {
                    if (
                      mode === "unrestricted" &&
                      !window.confirm(UNRESTRICTED_MODE_WARNING)
                    ) {
                      return;
                    }
                    save({ autonomyMode: mode });
                  }}
                />
                <div>
                  <p className="font-semibold capitalize text-neutral-200">{mode}</p>
                  <p className="mt-0.5 text-neutral-500">{AUTONOMY_INFO[mode]}</p>
                </div>
              </label>
            ))}
          </div>
          {settings.autonomyMode === "unrestricted" && (
            <div className="mt-3 rounded-lg border border-red-700 bg-red-900/30 p-3 text-xs text-red-200">
              <strong>UNRESTRICTED MODE IS ON.</strong> The agent will execute every action automatically — including
              sudo, package removal, killing processes, formatting disks, reading secrets, and modifying this
              framework — with <strong>no approval required</strong>. Global Pause and the hourly action cap still
              apply. You are fully responsible for anything it does.
            </div>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold">Limits</h2>
          <div className="mt-3 grid grid-cols-4 gap-4">
            <label className="text-xs text-neutral-400">
              Max tool steps / turn
              <input
                type="number"
                defaultValue={settings.maxAgentSteps}
                onBlur={(e) => save({ maxAgentSteps: Number(e.target.value) || 1 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="text-xs text-neutral-400">
              Max actions / hour
              <input
                type="number"
                defaultValue={settings.maxActionsPerHour}
                onBlur={(e) => save({ maxActionsPerHour: Number(e.target.value) || 1 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="text-xs text-neutral-400">
              Command timeout (sec)
              <input
                type="number"
                defaultValue={settings.commandTimeoutSec}
                onBlur={(e) => save({ commandTimeoutSec: Number(e.target.value) || 5 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="text-xs text-neutral-400">
              Tool retries on error
              <input
                type="number"
                defaultValue={settings.toolRetries}
                min={0}
                max={5}
                onBlur={(e) => save({ toolRetries: Number(e.target.value) || 0 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
              <span className="mt-1 block text-[10px] text-neutral-600">Retries on failure (1s between)</span>
            </label>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <label className="text-xs text-neutral-400">
              Min gap between sessions (min)
              <input
                type="number"
                defaultValue={settings.minGapMinutes}
                onBlur={(e) => save({ minGapMinutes: Number(e.target.value) || 0 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="text-xs text-neutral-400">
              Max autonomous sessions / day
              <input
                type="number"
                defaultValue={settings.maxSessionsPerDay}
                onBlur={(e) => save({ maxSessionsPerDay: Number(e.target.value) || 1 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="text-xs text-neutral-400">
              Max session duration (min)
              <input
                type="number"
                defaultValue={settings.maxSessionMinutes}
                onBlur={(e) => save({ maxSessionMinutes: Number(e.target.value) || 1 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <label className="text-xs text-neutral-400">
              Input price / 1M tokens (cache miss)
              <input
                type="number"
                step="0.01"
                defaultValue={settings.inputPricePerMTok}
                onBlur={(e) => save({ inputPricePerMTok: Number(e.target.value) || 0 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="text-xs text-neutral-400">
              Output price / 1M tokens
              <input
                type="number"
                step="0.01"
                defaultValue={settings.outputPricePerMTok}
                onBlur={(e) => save({ outputPricePerMTok: Number(e.target.value) || 0 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="text-xs text-neutral-400">
              Input price / 1M tokens (cache hit)
              <input
                type="number"
                step="0.0001"
                defaultValue={settings.cacheHitInputPricePerMTok}
                onBlur={(e) => save({ cacheHitInputPricePerMTok: Number(e.target.value) || 0 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
              <span className="mt-1 block text-[10px] text-neutral-600">DeepSeek caches prompt prefixes automatically.</span>
            </label>
          </div>
          <label className="mt-3 block text-xs text-neutral-400">
            Sandbox workspace directory
            <input
              defaultValue={settings.workspaceDir}
              onBlur={(e) => save({ workspaceDir: e.target.value })}
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
            />
            <span className="mt-1 block text-[10px] text-neutral-600">The agent&apos;s free-reign playground. Always treated as low risk.</span>
          </label>
          <label className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={settings.allowNetworkFetch}
              onChange={(e) => save({ allowNetworkFetch: e.target.checked })}
            />
            Allow outbound network fetches (fetch_url tool)
          </label>
        </section>

        <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold">Context management</h2>
          <p className="mt-1 text-xs text-neutral-500">
            When a conversation grows large, older messages are folded into a cached summary so the model&apos;s context
            window stays bounded and per-turn cost stays controlled. Your full history is always kept in the database.
          </p>
          <ToggleRow
            label="Auto-compact long conversations"
            desc="When the estimated context exceeds the max below, keep the most recent messages and summarize the rest."
            checked={settings.autoCompact}
            onToggle={(v) => save({ autoCompact: v })}
          />
          <div className="mt-3 grid grid-cols-2 gap-4">
            <label className="text-xs text-neutral-400">
              Max context tokens
              <input
                type="number"
                defaultValue={settings.maxContextTokens}
                onBlur={(e) => save({ maxContextTokens: Number(e.target.value) || 2000 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
              <span className="mt-1 block text-[10px] text-neutral-600">
                Start summarizing once history exceeds this.
              </span>
            </label>
            <label className="text-xs text-neutral-400">
              Keep recent tokens
              <input
                type="number"
                defaultValue={settings.compactTargetTokens}
                onBlur={(e) => save({ compactTargetTokens: Number(e.target.value) || 500 })}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none"
              />
              <span className="mt-1 block text-[10px] text-neutral-600">
                How many of the newest messages to keep verbatim.
              </span>
            </label>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold">Enabled tools</h2>
          <p className="mt-1 text-xs text-neutral-500">Turn off any capability you don&apos;t want the agent to have at all.</p>
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <button onClick={() => save({ enabledTools: tools.map((t) => t.name) })} className="rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-400 hover:bg-neutral-800">Select all</button>
              <button onClick={() => save({ enabledTools: [] })} className="rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-400 hover:bg-neutral-800">Deselect all</button>
            </div>
            {tools.map((t) => (
              <label key={t.name} className="flex items-start gap-3 rounded-lg border border-neutral-800 p-2.5 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={settings.enabledTools.includes(t.name)}
                  onChange={() => toggleTool(t.name)}
                />
                <div>
                  <p className="font-mono font-semibold text-neutral-200">{t.name}</p>
                  <p className="text-neutral-500">{t.description}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold">Extra protected paths</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Add any additional files/folders on top of the hard-coded ones that should always be blocked from writes/deletes.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="/home/user/important-project"
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs outline-none"
            />
            <button onClick={addProtectedPath} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">
              Add
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {settings.extraProtectedPaths.map((p) => (
              <span key={p} className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1 text-[11px] font-mono">
                {p}
                <button onClick={() => removeProtectedPath(p)} className="text-red-400 hover:text-red-300">
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>

        {hard && (
          <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-950 p-5">
            <h2 className="text-sm font-semibold text-neutral-300">🔒 Hard-coded self-protection (not editable)</h2>
            <p className="mt-1 text-xs text-neutral-500">
              These rules exist in code, not in the database, so the agent (or a misconfiguration) can never remove them. They exist to
              keep the framework itself — and the machine it runs on — from being destroyed.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 text-[11px]">
              <div>
                <p className="mb-1 font-semibold text-neutral-400">Never writable/deletable paths</p>
                <ul className="space-y-0.5 font-mono text-neutral-600">
                  {hard.protectedPaths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-semibold text-neutral-400">Never removable packages</p>
                <p className="font-mono text-neutral-600">{hard.protectedPackages.join(", ")}</p>
                <p className="mb-1 mt-3 font-semibold text-neutral-400">Never stoppable services</p>
                <p className="font-mono text-neutral-600">{hard.protectedServices.join(", ")}</p>
                <p className="mb-1 mt-3 font-semibold text-neutral-400">Never killable processes</p>
                <p className="font-mono text-neutral-600">{hard.protectedProcesses.join(", ")}</p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onToggle,
  danger,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs ${
        checked ? (danger ? "border-red-700 bg-red-950/30" : "border-amber-700 bg-amber-950/20") : "border-neutral-800"
      }`}
    >
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
      <div>
        <p className="font-semibold text-neutral-200">{label}</p>
        <p className="mt-0.5 text-neutral-500">{desc}</p>
      </div>
    </label>
  );
}

// A model name: suggestions from the API, but any name can be typed. Saves
// when the field loses focus or on Enter, not on every keystroke.
function ModelInput({ value, models, onSave }: { value: string; models: string[]; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };
  return (
    <>
      <input
        name="modelName"
        list="model-options"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none"
      />
      <datalist id="model-options">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}
