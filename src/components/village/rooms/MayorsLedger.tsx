"use client";

import FolderPicker from "./FolderPicker";
import { useEffect, useState, type ReactNode } from "react";
import type { SettingsRow } from "@/lib/agent/clientTypes";
import {
  AUTONOMY_INFO,
  AUTONOMY_MODES,
  UNRESTRICTED_MODE_WARNING,
  UNRESTRICTED_OVERRIDES_WARNING,
  useSettings,
  type SettingsPatch,
} from "../../data/useSettings";
import { jobSchedule, useJobs } from "../../data/useJobs";
import VillagersPage from "./VillagersPage";
import ProvidersPage from "./ProvidersPage";
import EmailPage from "./EmailPage";
import ParchmentDialog, { ConfirmDialog } from "../ParchmentDialog";
import { DEFAULT_PERSONA, personaToSave } from "@/lib/agent/persona";

// The Mayor's ledger in the town hall: every setting, one page per section,
// with the server's validation errors shown beside the field they belong to.
// Same data and checks as the Settings page (useSettings). Only the owner
// changes these; no agent can (docs/town-charter.md).

const PAGES = [
  { id: "town", label: "Pause & chat" },
  { id: "villagers", label: "Villagers" },
  { id: "freetime", label: "Work & life" },
  { id: "overrides", label: "Overrides" },
  { id: "identity", label: "Identity & model" },
  { id: "providers", label: "Providers" },
  { id: "email", label: "Email" },
  { id: "prompts", label: "Prompts" },
  { id: "autonomy", label: "Autonomy" },
  { id: "limits", label: "Limits" },
  { id: "context", label: "Context" },
  { id: "tools", label: "Tools" },
  { id: "paths", label: "Protected paths" },
  { id: "safeguards", label: "Fixed safeguards" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

type Settings = ReturnType<typeof useSettings>;
type Confirm = { title: string; message: string; label: string; patch: SettingsPatch } | null;

const input = "mt-1 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm font-normal outline-none";

export default function MayorsLedger({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [page, setPage] = useState<PageId>("town");
  const [confirm, setConfirm] = useState<Confirm>(null);

  if (confirm) {
    return (
      <ConfirmDialog
        title={confirm.title}
        message={<span className="whitespace-pre-line">{confirm.message}</span>}
        confirmLabel={confirm.label}
        onConfirm={() => {
          void s.save(confirm.patch);
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    );
  }

  const status = s.saving ? "Saving…" : s.saveError ? s.saveError : s.savedAt ? "Saved." : "";
  return (
    <ParchmentDialog kicker="The town hall" title="The Mayor's ledger — settings" onClose={onClose} tall>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav aria-label="Ledger pages" className="shrink-0 border-b-2 border-[#d8c49a] bg-[#ead9b4]/60 p-2 sm:w-44 sm:border-b-0 sm:border-r-2">
          <select
            aria-label="Ledger page"
            value={page}
            onChange={(e) => setPage(e.target.value as PageId)}
            className="w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 text-xs sm:hidden"
          >
            {PAGES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <ul className="hidden space-y-1 sm:block">
            {PAGES.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setPage(p.id)}
                  aria-current={page === p.id ? "page" : undefined}
                  className={`w-full rounded border-2 px-2 py-1.5 text-left text-xs ${
                    page === p.id ? "border-[#3b2716] bg-[#fffaf0] font-semibold" : "border-transparent hover:bg-[#fffaf0]/70"
                  }`}
                >
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!s.settings ? (
            <p className="text-sm">Opening the ledger…</p>
          ) : (
            <>
              {!s.deepSeekConfigured && !s.settings.apiKeySet && (
                <p className="mb-3 rounded border-2 border-[#b3261e] bg-[#fbe3df] px-3 py-2 text-xs text-[#7a1a14]">
                  <strong>No DeepSeek API key yet.</strong>{" "}Add one under Identity &amp; model so the agent can think.
                </p>
              )}
              <Page id={page} s={s} settings={s.settings} onConfirm={setConfirm} />
            </>
          )}
        </div>
      </div>
      <p
        role="status"
        className={`border-t-2 border-[#d8c49a] bg-[#ead9b4] px-4 py-1.5 text-[11px] ${s.saveError && !s.saving ? "text-[#b3261e]" : "text-[#3f6b22]"}`}
      >
        {status || "Changes save as you make them."}
      </p>
    </ParchmentDialog>
  );
}

function Page({ id, s, settings, onConfirm }: { id: PageId; s: Settings; settings: SettingsRow; onConfirm: (c: Confirm) => void }) {
  const save = (patch: SettingsPatch) => void s.save(patch);
  const err = (field: keyof SettingsRow) => s.fieldErrors[field];

  switch (id) {
    case "town":
      return (
        <Section title="Pause & chat">
          <div className="flex flex-wrap items-center gap-3 rounded border-2 border-[#3b2716] bg-[#fffaf0] p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{settings.paused ? "❄ Everyone is paused" : "The village is at work"}</p>
              <p className="text-xs text-[#6b4a2e]">
                {settings.paused
                  ? "All tool use and scheduled work is frozen. Chat still works; nothing runs until you resume."
                  : "Tools run by the autonomy rules. Pause to freeze every action and scheduled job at once."}
              </p>
            </div>
            <button
              onClick={() => save({ paused: !settings.paused })}
              className={`village-btn px-3 py-2 text-xs ${settings.paused ? "village-btn-go" : "village-btn-danger"}`}
            >
              {settings.paused ? "▶ Resume everyone" : "❄ Pause everyone"}
            </button>
          </div>
          <div className="rounded border-2 border-[#d8c49a] p-3">
            <p className="text-xs font-semibold">Day and night</p>
            <p className="text-[11px] text-[#6b4a2e]">
              The village keeps its own clock: a village day passes in a few real hours, so whenever the app is running the
              villagers work, spend their evenings and sleep. Or follow the computer&apos;s clock.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(["own", "real"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => save({ villageClock: c })}
                  className={`village-btn px-2 py-1 text-xs ${settings.villageClock === c ? "village-btn-go" : ""}`}
                  aria-pressed={settings.villageClock === c}
                >
                  {c === "own" ? "Its own clock" : "The computer's clock"}
                </button>
              ))}
            </div>
            {settings.villageClock === "own" && (
              <div className="mt-2 sm:w-1/2">
                <NumberField s={s} settings={settings} field="villageDayHours" label="A village day lasts (real hours)" step="1" help="1 to 24. At 4, the village wakes at 07:00 village time every 4 hours." />
              </div>
            )}
            <p className="mt-2 text-[11px] text-[#6b4a2e]">
              Bedtime and wake-up by the computer&apos;s clock: at night nothing starts on its own and computer jobs wait until
              morning. You can still knock and chat, and approvals still work.
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <TextField s={s} settings={settings} field="bedtime" label="Bedtime" type="time" />
              <TextField s={s} settings={settings} field="wakeTime" label="Wake-up" type="time" />
            </div>
          </div>
          <Toggle
            label="Human at the keyboard"
            desc="Tell the agent you're physically here, so it can coordinate interactive tests."
            checked={settings.humanAtKeyboard}
            onToggle={(v) => save({ humanAtKeyboard: v })}
          />
          <div className="rounded border-2 border-[#d8c49a] p-3">
            <p className="text-xs font-semibold">Default mode for new conversations</p>
            <p className="text-[11px] text-[#6b4a2e]">
              &quot;Just talk&quot; answers without tools; agentic may use tools. Each conversation keeps its own mode; scheduled
              work is always agentic.
            </p>
            <div className="mt-2 flex gap-1.5">
              {(["conversation", "agentic"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => save({ chatMode: m })}
                  aria-pressed={settings.chatMode === m}
                  className={`village-btn px-2.5 py-1 text-[11px] ${settings.chatMode === m ? "village-btn-go" : ""}`}
                >
                  {m === "conversation" ? "💬 Just talk" : "🤖 Agentic"}
                </button>
              ))}
            </div>
          </div>
        </Section>
      );

    case "overrides": {
      const anyOn =
        settings.unrestrictedMode ||
        settings.allowSecretReads ||
        settings.allowFrameworkMutations ||
        settings.allowDestructiveShell ||
        settings.allowProtectedSystemOps;
      return (
        <Section
          title="⚠ Supervisor overrides"
          intro="These actions are hard-blocked by default. An override lets the agent ask for them — each one still needs your approval and never runs on its own."
        >
          {anyOn && (
            <p className="rounded border-2 border-[#b3261e] bg-[#fbe3df] px-3 py-2 text-xs text-[#7a1a14]">
              <strong>You are responsible for anything the agent does with these on.</strong> Each risky action still waits
              for your approval.
            </p>
          )}
          <Toggle
            danger
            label="Allow all overrides"
            desc="Switches on every override below at once; each action still needs your approval. Not the same as the Unrestricted autonomy mode. Extreme caution."
            checked={settings.unrestrictedMode}
            onToggle={(v) =>
              v
                ? onConfirm({ title: "Switch on every override?", message: UNRESTRICTED_OVERRIDES_WARNING, label: "Switch them on", patch: { unrestrictedMode: true } })
                : save({ unrestrictedMode: false })
            }
          />
          <Toggle label="Allow reading secrets" desc=".env, .ssh/, id_rsa, credentials.json and the like." checked={settings.allowSecretReads} onToggle={(v) => save({ allowSecretReads: v })} />
          <Toggle label="Allow changing the framework's own files" desc="src/, scripts/, package.json, the database and so on." checked={settings.allowFrameworkMutations} onToggle={(v) => save({ allowFrameworkMutations: v })} />
          <Toggle label="Allow destructive shell commands" desc="rm -rf /, mkfs, fork bombs, killing PID 1, chmod -R 777 /…" checked={settings.allowDestructiveShell} onToggle={(v) => save({ allowDestructiveShell: v })} />
          <Toggle label="Allow protected system operations" desc="Removing core packages, stopping protected services, killing protected processes." checked={settings.allowProtectedSystemOps} onToggle={(v) => save({ allowProtectedSystemOps: v })} />
        </Section>
      );
    }

    case "villagers":
      return (
        <>
          <HiringSettings s={s} settings={settings} />
          <VillagersPage settings={settings} tools={s.tools} />
        </>
      );

    case "freetime":
      return (
        <>
          <DaySplit s={s} settings={settings} save={save} />
          <FreeTimePage settings={settings} />
        </>
      );

    case "providers":
      return <ProvidersPage />;
    case "email":
      return <EmailPage />;

    case "identity":
      return <IdentityPage s={s} settings={settings} />;

    case "prompts":
      return <PromptsPage settings={settings} save={save} err={err} />;

    case "autonomy":
      return (
        <Section title="Autonomy" intro="How much the agent may do without asking you first.">
          <div role="radiogroup" aria-label="Autonomy mode" className="space-y-2">
            {AUTONOMY_MODES.map((mode) => (
              <label
                key={mode}
                className={`flex cursor-pointer items-start gap-3 rounded border-2 p-3 text-xs ${
                  settings.autonomyMode === mode ? (mode === "unrestricted" ? "border-[#b3261e] bg-[#fbe3df]" : "border-[#3b2716] bg-[#fffaf0]") : "border-[#d8c49a]"
                }`}
              >
                <input
                  type="radio"
                  name="autonomyMode"
                  className="mt-0.5"
                  checked={settings.autonomyMode === mode}
                  onChange={() =>
                    mode === "unrestricted"
                      ? onConfirm({ title: "Turn off every approval?", message: UNRESTRICTED_MODE_WARNING, label: "Yes, unrestricted", patch: { autonomyMode: mode } })
                      : save({ autonomyMode: mode })
                  }
                />
                <span>
                  <span className="village-pixel block text-sm capitalize">{mode}</span>
                  <span className="text-[#6b4a2e]">{AUTONOMY_INFO[mode]}</span>
                </span>
              </label>
            ))}
          </div>
          {settings.autonomyMode === "unrestricted" && (
            <p className="rounded border-2 border-[#b3261e] bg-[#fbe3df] px-3 py-2 text-xs text-[#7a1a14]">
              <strong>UNRESTRICTED MODE IS ON.</strong> Every action runs with no approval. Pause and the hourly cap still
              apply. You are fully responsible for anything it does.
            </p>
          )}
        </Section>
      );

    case "limits":
      return (
        <Section title="Limits" intro="Caps on how much the agent does per turn, per hour and per day, and what it costs.">
          <Toggle
            label="No limits"
            desc="Lifts the daily budgets (the village's and each villager's), work sessions per day and the gap between them, actions per hour and steps per turn. The safety rules, approvals and protected paths stay as they are, and so do the longest session and the meeting, vote and away budgets."
            checked={settings.noLimits}
            onToggle={(v) => save({ noLimits: v })}
          />
          <MoneyField
            s={s}
            settings={settings}
            field="spendCeilingUsd"
            label="Emergency ceiling (USD a day)"
            placeholder="No ceiling"
            help="A backstop, with or without No limits: once the village has spent this today, all work stops until midnight, research too. The spend so far is in the bar at the top of the village."
          />
          {settings.noLimits && (
            <p className="rounded border-2 border-[#c98a2b] bg-[#fbf0d9] px-3 py-2 text-xs text-[#6b4a2e]">
              <strong>No limits is on.</strong>{" "}
              {`The caps below are kept for when you switch it off, but don't apply now.${settings.spendCeilingUsd == null ? " Without an emergency ceiling, a villager stuck in a loop can spend until its session's time runs out." : ""}`}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField s={s} settings={settings} field="maxAgentSteps" label="Tool steps per turn" />
            <NumberField s={s} settings={settings} field="maxActionsPerHour" label="Actions per hour" />
            <NumberField s={s} settings={settings} field="commandTimeoutSec" label="Command timeout (seconds)" />
            <NumberField s={s} settings={settings} field="toolRetries" label="Retries when a tool fails" help="1 second apart." />
            <NumberField s={s} settings={settings} field="minGapMinutes" label="Gap between each villager's work sessions (min)" />
            <NumberField s={s} settings={settings} field="maxSessionsPerDay" label="Work sessions per villager per day" />
            <NumberField s={s} settings={settings} field="maxSessionMinutes" label="Longest work session (min)" />
            <NumberField s={s} settings={settings} field="inputPricePerMTok" label="Input price per 1M tokens" step="0.01" />
            <NumberField s={s} settings={settings} field="outputPricePerMTok" label="Output price per 1M tokens" step="0.01" />
            <NumberField s={s} settings={settings} field="cacheHitInputPricePerMTok" label="Cached input price per 1M tokens" step="0.0001" help="DeepSeek caches prompt prefixes automatically." />
          </div>
          <MoneyField
            s={s}
            settings={settings}
            field="townDailyBudgetUsd"
            label="The village's daily budget (USD)"
            placeholder="No town budget"
            help="When everyone together has spent this today, every villager stops until midnight. Each villager can also have a budget of their own (Villagers)."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField s={s} settings={settings} field="meetingCostCapUsd" label="Budget per town meeting (USD)" step="0.01" help="A meeting's round stops when it has spent this." />
            <NumberField s={s} settings={settings} field="voteCostCapUsd" label="Budget per round of votes (USD)" step="0.01" help="A vote stops collecting when it has spent this." />
            <NumberField s={s} settings={settings} field="awaySpendCapUsd" label="Away-mode budget (USD)" step="0.01" help="While you're away, the Mayor stops approving once the village has spent this." />
          </div>
          <WorkspaceField s={s} settings={settings} />
          <Toggle
            label="Allow fetching from the web"
            desc="The fetch_url and download_file tools. This machine's own services are always off limits."
            checked={settings.allowNetworkFetch}
            onToggle={(v) => save({ allowNetworkFetch: v })}
          />
        </Section>
      );

    case "context":
      return (
        <Section
          title="Context"
          intro="When a conversation grows long, older messages are folded into a summary so each turn stays affordable. The full history stays in the database."
        >
          <Toggle
            label="Fold long conversations automatically"
            desc="Above the size below, keep the newest messages and summarize the rest."
            checked={settings.autoCompact}
            onToggle={(v) => save({ autoCompact: v })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField s={s} settings={settings} field="maxContextTokens" label="Fold above (tokens)" />
            <NumberField s={s} settings={settings} field="compactTargetTokens" label="Keep the newest (tokens)" />
          </div>
        </Section>
      );

    case "tools":
      return (
        <Section title="Tools" intro="Switch off anything you don't want the agent to be able to do at all.">
          <WebSearchSettings s={s} settings={settings} />
          <div className="flex gap-1.5">
            <button onClick={() => save({ enabledTools: s.tools.map((t) => t.name) })} className="village-btn px-2 py-1 text-[11px]">
              All on
            </button>
            <button onClick={() => save({ enabledTools: [] })} className="village-btn px-2 py-1 text-[11px]">
              All off
            </button>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {s.tools.map((t) => (
              <li key={t.name}>
                <label className="flex cursor-pointer items-start gap-2 rounded border-2 border-[#d8c49a] bg-[#fffaf0] p-2 text-xs">
                  <input type="checkbox" name={`tool-${t.name}`} className="mt-0.5" checked={settings.enabledTools.includes(t.name)} onChange={() => s.toggleTool(t.name)} />
                  <span>
                    <span className="block font-mono font-semibold">{t.name}</span>
                    <span className="text-[#6b4a2e]">{t.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <FieldError msg={err("enabledTools")} />
        </Section>
      );

    case "paths":
      return <PathsPage s={s} settings={settings} />;

    case "safeguards":
      return (
        <Section
          title="🔒 Fixed safeguards"
          intro="These live in the code, not the database, so neither the agent nor a bad setting can remove them. They keep the framework — and the machine — in one piece."
        >
          {s.hard && (
            <div className="grid gap-3 text-[11px] sm:grid-cols-2">
              <div>
                <p className="mb-1 font-semibold">Never written or deleted</p>
                <ul className="space-y-0.5 break-all font-mono text-[#5a3d25]">
                  {s.hard.protectedPaths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-3">
                <ReadOnlyList title="Packages never removed" items={s.hard.protectedPackages} />
                <ReadOnlyList title="Services never stopped" items={s.hard.protectedServices} />
                <ReadOnlyList title="Processes never killed" items={s.hard.protectedProcesses} />
              </div>
            </div>
          )}
        </Section>
      );
  }
}

function IdentityPage({ s, settings }: { s: Settings; settings: SettingsRow }) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.apiBaseUrl || "");
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const save = (patch: SettingsPatch) => void s.save(patch);

  return (
    <Section title="Identity & model">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField s={s} settings={settings} field="agentName" label="The agent's name" />
        <label className="block text-xs font-semibold">
          API base URL
          <input name="apiBaseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" className={input} />
        </label>
      </div>
      <label className="block text-xs font-semibold">
        Personality
        <textarea
          name="persona"
          key={`persona:${settings.persona ?? ""}`}
          defaultValue={settings.persona ?? DEFAULT_PERSONA}
          onBlur={(e) => {
            const v = personaToSave(e.target.value);
            if (v !== (settings.persona ?? null)) save({ persona: v });
          }}
          rows={4}
          className={`${input} resize-y`}
        />
        <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">
          Who {settings.agentName} is, in your words: how they talk and what they’re like. Edit or add to the default; clear the box to go back to it.
        </span>
        <FieldError msg={s.fieldErrors.persona} />
      </label>
      <div className="rounded border-2 border-[#d8c49a] p-3">
        <p className="text-xs">
          DeepSeek API key:{" "}
          <strong className={settings.apiKeySet ? "text-[#3f6b22]" : "text-[#b3261e]"}>{settings.apiKeySet ? "saved" : "not set"}</strong>
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            name="apiKey"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.apiKeySet ? "Enter a new key to replace it…" : "sk-…"}
            autoComplete="off"
            className={`${input} mt-0`}
          />
          <button
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setMsg(null);
              setMsg(await s.testAndLoadModels(apiKey, baseUrl));
              setApiKey("");
              setTesting(false);
            }}
            className="village-btn village-btn-primary px-3 py-1.5 text-xs"
          >
            {testing ? "Testing…" : "Test & load models"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-[#6b4a2e]">Saves the key on this machine (never shown again) and asks the API which models it offers.</p>
        {msg && <p className={`mt-1 text-[11px] ${msg.startsWith("error") ? "text-[#b3261e]" : "text-[#3f6b22]"}`}>{msg}</p>}
      </div>
      <label className="block text-xs font-semibold">
        Model
        <input
          name="modelName"
          list="ledger-models"
          key={`model:${settings.modelName}`}
          defaultValue={settings.modelName}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== settings.modelName) save({ modelName: v });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={input}
        />
        <datalist id="ledger-models">
          {s.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">
          {s.models.length ? "Pick one the API offers, or type any model name." : "Type a model name, or test the key to list the models."}
        </span>
        <FieldError msg={s.fieldErrors.modelName} />
      </label>
      <Toggle
        label="Thinking (chain of thought)"
        desc="DeepSeek reasons before answering, which spends output tokens on every step. Less effort, or off, costs less."
        checked={settings.thinkingEnabled}
        onToggle={(v) => save({ thinkingEnabled: v })}
      />
      {settings.thinkingEnabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold">
            Reasoning effort
            <select name="reasoningEffort" value={settings.reasoningEffort} onChange={(e) => save({ reasoningEffort: e.target.value })} className={input}>
              <option value="low">low (cheapest)</option>
              <option value="high">high</option>
              <option value="max">max</option>
            </select>
          </label>
          <NumberField s={s} settings={settings} field="maxOutputTokens" label="Output tokens per step" step="100" help="Caps reasoning plus answer per model call." />
          <label className="block text-xs font-semibold">
            Think for
            <select name="thinkingFor" value={settings.thinkingFor} onChange={(e) => save({ thinkingFor: e.target.value as SettingsRow["thinkingFor"] })} className={input}>
              <option value="work">work only (chats and meetings answer straight)</option>
              <option value="all">everything</option>
            </select>
          </label>
        </div>
      )}
      <NumberField
        s={s}
        settings={settings}
        field="talkTemperature"
        label="Talk temperature"
        step="0.1"
        help="0 to 2. Used for village talk without thinking (chats, meetings, votes, village life). Lower is plainer; DeepSeek ignores it while thinking."
      />
      <label className="block text-xs font-semibold">
        Extra instructions (optional)
        <textarea
          name="systemPromptExtra"
          key={`extra:${settings.systemPromptExtra ?? ""}`}
          defaultValue={settings.systemPromptExtra || ""}
          onBlur={(e) => {
            if (e.target.value !== (settings.systemPromptExtra || "")) save({ systemPromptExtra: e.target.value });
          }}
          rows={3}
          placeholder="e.g. Focus on Python tooling this week. Don't install anything over 500MB."
          className={`${input} resize-y`}
        />
        <FieldError msg={s.fieldErrors.systemPromptExtra} />
      </label>
    </Section>
  );
}

// Work the agent starts on its own. Both are off on a new install (#52); they
// are ordinary jobs, so the workshop can change their schedule too.
// How the villagers' own time splits between computer work and village life
// (#130). Your own requests always run, whatever is chosen here.
const SPLIT_MODES: Array<{ id: SettingsRow["lifeBalance"]; label: string; desc: string }> = [
  { id: "idle", label: "Village life when idle", desc: "Computer jobs always come first; village life fills the gaps." },
  { id: "hours", label: "Work hours, then village life", desc: "Computer jobs run in work hours; outside them it's village life, and jobs wait for the next work hours." },
  { id: "balanced", label: "Balanced", desc: "Aim for a share of computer work through the day; the rest is village life." },
];

function DaySplit({ s, settings, save }: { s: Settings; settings: SettingsRow; save: (p: SettingsPatch) => void }) {
  return (
    <Section
      title="Work & life"
      intro="Every villager has a trade and a life in the village (the farm, the bakery, the tavern, their friends), worked out without any model calls. Switch on village life for a villager (Villagers page) and once a day they also get a short life window of their own, with village tools only. This is how their own time splits between computer jobs and village life; anything you ask them always runs."
    >
      <div role="radiogroup" aria-label="Day split" className="space-y-2">
        {SPLIT_MODES.map((m) => (
          <label
            key={m.id}
            className={`flex cursor-pointer items-start gap-3 rounded border-2 p-3 text-xs ${settings.lifeBalance === m.id ? "border-[#3b2716] bg-[#fffaf0]" : "border-[#d8c49a]"}`}
          >
            <input type="radio" name="lifeBalance" className="mt-0.5" checked={settings.lifeBalance === m.id} onChange={() => save({ lifeBalance: m.id })} />
            <span>
              <span className="village-pixel block text-sm">{m.label}</span>
              <span className="text-[#6b4a2e]">{m.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {settings.lifeBalance === "hours" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField s={s} settings={settings} field="workStart" label="Work starts" type="time" />
          <TextField s={s} settings={settings} field="workEnd" label="Work ends" type="time" />
        </div>
      )}
      {settings.lifeBalance === "balanced" && (
        <label className="block text-xs font-semibold">
          Computer work: {settings.workShare}% of their own time
          <input
            type="range"
            name="workShare"
            min={0}
            max={100}
            step={5}
            defaultValue={settings.workShare}
            key={settings.workShare}
            onPointerUp={(e) => save({ workShare: Number((e.target as HTMLInputElement).value) })}
            onKeyUp={(e) => save({ workShare: Number((e.target as HTMLInputElement).value) })}
            className="mt-1 block w-full"
          />
        </label>
      )}
      <label className="block text-xs font-semibold">
        Flaws the Mayor may give a newcomer
        <select name="flawsAllowed" value={settings.flawsAllowed} onChange={(e) => save({ flawsAllowed: e.target.value as SettingsRow["flawsAllowed"] })} className={input}>
          <option value="none">None</option>
          <option value="one">At most one</option>
          <option value="any">Any</option>
        </select>
        <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">Lazy, light-fingered and shifty. You can give anyone any traits yourself on the Villagers page.</span>
      </label>
      <NumberField s={s} settings={settings} field="lifeBudgetUsd" label="Life windows: daily budget per villager (USD)" step="0.01" help="A life window is a few short model calls; it's skipped once a villager has spent this on village life today." />
      <p className="text-[11px] text-[#6b4a2e]">Each villager can have their own split on the Villagers page.</p>
    </Section>
  );
}

function FreeTimePage({ settings }: { settings: SettingsRow }) {
  const { jobs, loaded, setEnabled } = useJobs();
  const own = [
    {
      kind: "self_work" as const,
      label: "Let the agent work on its own ideas",
      desc: "A work window where it picks a goal from the notice board and makes progress on it.",
    },
    {
      kind: "daily_report" as const,
      label: "Daily self-report",
      desc: "Each morning it writes what it did, what it spent and its plan for the day into the diary.",
    },
  ];
  return (
    <Section
      title="Work on their own"
      intro="Work the agent starts on its own, without being asked. Each run is a work session: it counts toward the daily session cap and the gap between sessions (Limits), and every risky action still needs your approval."
    >
      {!loaded && <p className="text-sm">Checking the job board…</p>}
      {own.map((o) => {
        const job = jobs.find((j) => j.kind === o.kind);
        if (loaded && !job) {
          return (
            <p key={o.kind} className="rounded border-2 border-dashed border-[#c9b27a] p-3 text-xs">
              <strong>{o.label}:</strong> the worker adds this job the first time it starts (<code>npm run worker</code>).
            </p>
          );
        }
        if (!job) return null;
        return (
          <div key={o.kind}>
            <Toggle label={o.label} desc={o.desc} checked={job.enabled} onToggle={(v) => void setEnabled(job, v)} />
            <p className="mt-1 text-[11px] text-[#6b4a2e]">
              {o.kind === "daily_report" ? "Every morning at 09:00" : jobSchedule(job)}, up to {job.maxDurationMinutes}{" "}min each time. Change it at the workshop&apos;s job board.
            </p>
          </div>
        );
      })}
      <p className="text-[11px] text-[#6b4a2e]">
        {settings.noLimits
          ? "No limits is on: no cap on work sessions a day and no gap between them."
          : `Each villager: up to ${settings.maxSessionsPerDay} work sessions a day, at least ${settings.minGapMinutes} min apart. Village-life windows don't count.`}
      </p>
    </Section>
  );
}

function PathsPage({ s, settings }: { s: Settings; settings: SettingsRow }) {
  const [path, setPath] = useState("");
  return (
    <Section title="Protected paths" intro="Files and folders the agent may never write to or delete, on top of the fixed ones.">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!path.trim()) return;
          s.addProtectedPath(path);
          setPath("");
        }}
      >
        <input name="newPath" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/home/me/important-project" className={`${input} mt-0 font-mono text-xs`} />
        <button type="submit" disabled={!path.trim()} className="village-btn village-btn-primary px-3 py-1.5 text-xs">
          Add
        </button>
      </form>
      <FieldError msg={s.fieldErrors.extraProtectedPaths} />
      {settings.extraProtectedPaths.length === 0 && <p className="text-xs text-[#6b4a2e]">None added.</p>}
      <ul className="flex flex-wrap gap-1.5">
        {settings.extraProtectedPaths.map((p) => (
          <li key={p} className="flex items-center gap-2 rounded-full border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-0.5 font-mono text-[11px]">
            {p}
            <button onClick={() => s.removeProtectedPath(p)} aria-label={`Remove ${p}`} className="font-bold text-[#b3261e]">
              ×
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// --- small pieces -------------------------------------------------------------------

type PromptField = "staticCorePrompt" | "workWindowPrompt" | "focusedChatPrompt" | "truncationMessage";
const PROMPT_FIELDS: Array<[PromptField, string, number]> = [
  ["staticCorePrompt", "Core (identity, environment, guardrails, behavior, formatting, cost)", 14],
  ["workWindowPrompt", "Work window (scheduled jobs)", 6],
  ["focusedChatPrompt", "Focused chat", 4],
  ["truncationMessage", "When the step limit is reached", 4],
];

// Each box shows the built-in prompt (greyed) until the owner writes their own;
// "Start from the built-in" copies it in to edit.
function PromptsPage({ settings, save, err }: { settings: SettingsRow; save: (p: SettingsPatch) => void; err: (f: keyof SettingsRow) => string | undefined }) {
  const [defaults, setDefaults] = useState<Record<PromptField, string> | null>(null);
  const [seeded, setSeeded] = useState<Partial<Record<PromptField, string>>>({});
  useEffect(() => {
    let live = true;
    fetch("/api/settings/prompt-defaults", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setDefaults(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [settings.autonomyMode, settings.maxSessionMinutes, settings.maxAgentSteps]);
  return (
    <Section
      title="Prompts"
      intro="What the villagers are told. An empty box uses the built-in prompt, shown greyed out. In your own, {name} becomes the villager's name, {role} their job (the village's mayor), {persona} their personality and {workspace} their folder."
    >
      {PROMPT_FIELDS.map(([field, label, rows]) => {
        const own = settings[field];
        const seed = seeded[field];
        return (
          <label key={field} className="block text-xs font-semibold">
            {label}
            <textarea
              name={field}
              key={`${field}:${own ?? ""}:${seed ?? ""}`}
              defaultValue={own ?? seed ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() ? e.target.value : null;
                if (v !== own && !(seed && v === seed)) save({ [field]: v });
              }}
              rows={rows}
              placeholder={defaults?.[field] ?? "Loading the built-in prompt…"}
              className={`${input} resize-y font-mono text-[11px] placeholder:text-[#9a8466]`}
            />
            <span className="mt-0.5 flex flex-wrap items-center gap-2 font-normal text-[11px] text-[#6b4a2e]">
              {own ? `Your own: ${own.length.toLocaleString()} characters` : seed ? "Edit, then click away to save it as your own." : "Using the built-in prompt (shown above)."}
              {!own && !seed && defaults && (
                <button type="button" onClick={() => setSeeded((s) => ({ ...s, [field]: defaults[field] }))} className="underline">
                  Start from the built-in
                </button>
              )}
              {own && (
                <button type="button" onClick={() => save({ [field]: null })} className="underline">
                  Go back to the built-in
                </button>
              )}
            </span>
            {field === "staticCorePrompt" && !own && (
              <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">
                The built-in core follows your settings (autonomy, overrides, this computer); a copy you save stays as you wrote it.
              </span>
            )}
            <FieldError msg={err(field)} />
          </label>
        );
      })}
    </Section>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="village-pixel text-sm">{title}</h3>
        {intro && <p className="mt-0.5 text-xs text-[#6b4a2e]">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Toggle({ label, desc, checked, onToggle, danger }: { label: string; desc: string; checked: boolean; onToggle: (v: boolean) => void; danger?: boolean }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded border-2 p-3 text-xs ${
        checked ? (danger ? "border-[#b3261e] bg-[#fbe3df]" : "border-[#c58a1b] bg-[#fbecc8]") : "border-[#d8c49a]"
      }`}
    >
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="text-[#6b4a2e]">{desc}</span>
      </span>
    </label>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? (
    <span role="alert" className="mt-1 block text-[11px] font-semibold text-[#b3261e]">
      {msg}
    </span>
  ) : null;
}

type NumberKey = {
  [K in keyof SettingsRow]: SettingsRow[K] extends number ? K : never;
}[keyof SettingsRow];

// What's typed in a field. It follows the saved value, except while the server
// is refusing what was typed: then the typed text stays so it can be fixed.
function useDraft(value: string, error: string | undefined) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced && !error) {
    setSynced(value);
    setDraft(value);
  }
  return [draft, setDraft] as const;
}

// A number saved when you leave the field (or press Enter). If the server
// refuses it, the typed value stays and the reason shows underneath.
function NumberField({ s, settings, field, label, help, step }: { s: Settings; settings: SettingsRow; field: NumberKey; label: string; help?: string; step?: string }) {
  const error = s.fieldErrors[field];
  const [draft, setDraft] = useDraft(String(settings[field]), error);
  const commit = () => {
    if (draft === String(settings[field])) s.clearFieldError(field);
    else void s.save({ [field]: draft.trim() === "" ? NaN : Number(draft) });
  };
  return (
    <label className="block text-xs font-semibold">
      {label}
      <input
        type="number"
        name={field}
        step={step}
        value={draft}
        aria-invalid={Boolean(error)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className={`${input} ${error ? "border-[#b3261e]" : ""}`}
      />
      {help && <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">{help}</span>}
      <FieldError msg={error} />
    </label>
  );
}

function TextField({
  s,
  settings,
  field,
  label,
  help,
  type = "text",
}: {
  s: Settings;
  settings: SettingsRow;
  field: "agentName" | "workspaceDir" | "bedtime" | "wakeTime" | "workStart" | "workEnd";
  label: string;
  help?: string;
  type?: "text" | "time";
}) {
  const error = s.fieldErrors[field];
  const [draft, setDraft] = useDraft(settings[field], error);
  const commit = () => {
    if (draft === settings[field]) s.clearFieldError(field);
    else void s.save({ [field]: draft });
  };
  return (
    <label className="block text-xs font-semibold">
      {label}
      <input
        name={field}
        type={type}
        value={draft}
        aria-invalid={Boolean(error)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className={`${input} ${error ? "border-[#b3261e]" : ""}`}
      />
      {help && <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">{help}</span>}
      <FieldError msg={error} />
    </label>
  );
}

// Where web_search looks (#170): a Tavily key (free each month), a Brave key
// and the owner's own SearXNG, each optional; DuckDuckGo and Wikipedia are
// always tried after them.
function SearchKeyField({ s, field, set, label, placeholder, help }: { s: Settings; field: "tavilyApiKey" | "searchApiKey"; set: boolean; label: string; placeholder: string; help: ReactNode }) {
  const [key, setKey] = useState("");
  return (
    <div>
      {label}: <strong className={set ? "text-[#3f6b22]" : "text-[#6b4a2e]"}>{set ? "saved" : "not set"}</strong>
      <div className="mt-1 flex gap-2">
        <input
          type="password"
          name={field}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={set ? "Enter a new key to replace it…" : placeholder}
          autoComplete="off"
          className={`${input} mt-0`}
        />
        <button
          disabled={!key.trim()}
          onClick={async () => {
            await s.save({ [field]: key.trim() });
            setKey("");
          }}
          className="village-btn village-btn-primary px-3 py-1.5 text-xs"
        >
          Save
        </button>
        {set && (
          <button onClick={() => void s.save({ [field]: null })} className="village-btn px-3 py-1.5 text-xs">
            Remove
          </button>
        )}
      </div>
      <span className="mt-0.5 block text-[11px] text-[#6b4a2e]">{help}</span>
    </div>
  );
}

function WebSearchSettings({ s, settings }: { s: Settings; settings: SettingsRow }) {
  const [url, setUrl] = useDraft(settings.searxngUrl ?? "", s.fieldErrors.searxngUrl);
  const [trying, setTrying] = useState<string | null>(null);
  const saveUrl = () => {
    if (url !== (settings.searxngUrl ?? "")) void s.save({ searxngUrl: url.trim() || null });
  };
  return (
    <div className="space-y-2 rounded border-2 border-[#d8c49a] p-3 text-xs">
      <p className="font-semibold">Web search</p>
      <p className="text-[11px] text-[#6b4a2e]">
        web_search tries these in turn: DeepSeek&apos;s own search (with the village&apos;s DeepSeek key), Tavily with your key, Brave and your own SearXNG if you set them up; then Tavily without a key (free and rate-limited), DuckDuckGo and Wikipedia.
      </p>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={settings.deepseekSearch} onChange={(e) => void s.save({ deepseekSearch: e.target.checked })} />
        <span>
          <span className="font-semibold">Search with DeepSeek</span>
          <span className="block text-[11px] text-[#6b4a2e]">
            Uses your DeepSeek key, so there&apos;s nothing to sign up for: $0.75 per 1,000 searches (under a tenth of a cent each), counted in the day&apos;s spend and the budgets. Only when the village runs on DeepSeek&apos;s own API.
          </span>
        </span>
      </label>
      <SearchKeyField
        s={s}
        field="tavilyApiKey"
        set={settings.tavilyKeySet}
        label="Tavily key"
        placeholder="tvly-… from app.tavily.com"
        help={
          <>
            Sign up at{" "}
            <a href="https://app.tavily.com/" target="_blank" rel="noreferrer" className="underline">
              app.tavily.com
            </a>{" "}
            and copy the key. Kept on this machine; never shown again or given to the villagers.
          </>
        }
      />
      <SearchKeyField
        s={s}
        field="searchApiKey"
        set={settings.searchKeySet}
        label="Brave Search key"
        placeholder="The key from api.search.brave.com"
        help="If you have one (Brave's free credit now needs a card). Kept on this machine; never shown again or given to the villagers."
      />
      <label className="block font-semibold">
        Your SearXNG (optional)
        <input
          name="searxngUrl"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={saveUrl}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveUrl();
          }}
          placeholder="http://localhost:8888"
          className={input}
        />
        <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">
          The address of a SearXNG you run, with its JSON format switched on. It&apos;s free and has no limits: it searches many engines itself.
        </span>
        <FieldError msg={s.fieldErrors.searxngUrl} />
      </label>
      <button
        onClick={async () => {
          setTrying("Searching…");
          const res = await fetch("/api/search?q=watermill").then((r) => r.json()).catch(() => ({ output: "Couldn't reach the app." }));
          const lines = String(res.output ?? res.error ?? "").split("\n");
          const first = lines.find((l) => /^1\. /.test(l))?.replace(/^1\. |\*\*/g, "");
          setTrying(`${lines[0].replace(/:$/, "")}${first ? `. First: ${first}` : ""}`);
        }}
        className="village-btn px-2 py-1 text-[11px]"
      >
        Try a search
      </button>
      {trying && <p className="text-[11px]">{trying}</p>}
    </div>
  );
}

// The workspace (#157): typed, or chosen with the folder picker.
function WorkspaceField({ s, settings }: { s: Settings; settings: SettingsRow }) {
  const [picking, setPicking] = useState(false);
  return (
    <div>
      <TextField
        s={s}
        settings={settings}
        field="workspaceDir"
        label="The agent's workspace"
        help="Its own folder to play in: always low risk. Not a drive's or the filesystem's root, a system folder, your home folder itself, or this framework's folder."
      />
      <button type="button" onClick={() => setPicking(true)} className="village-btn mt-1 px-2 py-1 text-[11px]">
        📁 Browse…
      </button>
      {picking && (
        <FolderPicker
          start={settings.workspaceDir}
          onClose={() => setPicking(false)}
          onPick={(dir) => {
            setPicking(false);
            void s.save({ workspaceDir: dir });
          }}
        />
      )}
    </div>
  );
}

// A daily amount in USD where empty means none: the village's budget (#60)
// and the emergency ceiling (#171).
function MoneyField({
  s,
  settings,
  field,
  label,
  placeholder,
  help,
}: {
  s: Settings;
  settings: SettingsRow;
  field: "townDailyBudgetUsd" | "spendCeilingUsd";
  label: string;
  placeholder: string;
  help: string;
}) {
  const error = s.fieldErrors[field];
  const value = settings[field];
  const saved = value == null ? "" : String(value);
  const [draft, setDraft] = useDraft(saved, error);
  const commit = () => {
    if (draft === saved) s.clearFieldError(field);
    else void s.save({ [field]: draft.trim() === "" ? null : Number(draft) });
  };
  return (
    <label className="block text-xs font-semibold">
      {label}
      <input
        type="number"
        name={field}
        min={0}
        step="0.01"
        value={draft}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className={`${input} ${error ? "border-[#b3261e]" : ""}`}
      />
      <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">{help}</span>
      <FieldError msg={error} />
    </label>
  );
}

// Hiring (#99): who decides, and how many the village can hold.
function HiringSettings({ s, settings }: { s: Settings; settings: SettingsRow }) {
  const error = s.fieldErrors.maxPopulation;
  const saved = String(settings.maxPopulation);
  const [draft, setDraft] = useDraft(saved, error);
  const commit = () => {
    if (draft === saved) s.clearFieldError("maxPopulation");
    else void s.save({ maxPopulation: Number(draft) });
  };
  return (
    <div className="mb-4 rounded border-2 border-[#d8c49a] p-3">
      <p className="text-xs font-semibold">Hiring</p>
      <p className="text-[11px] text-[#6b4a2e]">
        The Mayor and directors can draft new villagers when there&apos;s more work than they can do. The Mayor interviews each
        one first. Hire requests wait at the clerk&apos;s desk in the town hall.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Who decides hires">
        {(["ask", "auto"] as const).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={settings.hiringMode === m}
            onClick={() => void s.save({ hiringMode: m })}
            className={`village-btn px-2.5 py-1 text-[11px] ${settings.hiringMode === m ? "village-btn-go" : ""}`}
          >
            {m === "ask" ? "✋ I decide every hire" : "🎩 The Mayor hires within the limits"}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-[#6b4a2e]">
        {settings.hiringMode === "ask"
          ? "Every hire waits for you, with the Mayor's interview to read."
          : "When the Mayor recommends someone, they're hired straight away and you're told. New villagers never get more tools or budget than whoever drafted them."}
      </p>
      <label className="mt-2 block max-w-xs text-xs font-semibold">
        Room for (villagers, the Mayor included)
        <input
          type="number"
          name="maxPopulation"
          min={1}
          max={50}
          value={draft}
          aria-invalid={Boolean(error)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          className={`${input} ${error ? "border-[#b3261e]" : ""}`}
        />
        <FieldError msg={error} />
      </label>
    </div>
  );
}

function ReadOnlyList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 font-semibold">{title}</p>
      <p className="font-mono text-[#5a3d25]">{items.join(", ")}</p>
    </div>
  );
}
