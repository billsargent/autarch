"use client";

import { useState, type ReactNode } from "react";
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
import ParchmentDialog, { ConfirmDialog } from "../ParchmentDialog";
import { DEFAULT_PERSONA, personaToSave } from "@/lib/agent/persona";

// The Mayor's ledger in the town hall: every setting, one page per section,
// with the server's validation errors shown beside the field they belong to.
// Same data and checks as the Settings page (useSettings). Only the owner
// changes these; no agent can (docs/town-charter.md).

const PAGES = [
  { id: "town", label: "Pause & chat" },
  { id: "villagers", label: "Villagers" },
  { id: "freetime", label: "Free time" },
  { id: "overrides", label: "Overrides" },
  { id: "identity", label: "Identity & model" },
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
              By the computer&apos;s own clock. At night the villagers sleep and nothing starts on its own; jobs that fall due wait
              until morning. You can still knock and chat, and approvals still work.
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
            label="Unrestricted overrides"
            desc="Switches on every override below at once. Extreme caution."
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
      return <VillagersPage settings={settings} tools={s.tools} />;

    case "freetime":
      return <FreeTimePage settings={settings} />;

    case "identity":
      return <IdentityPage s={s} settings={settings} />;

    case "prompts":
      return (
        <Section title="Prompts" intro="What the model is told. Leave a box empty to use the built-in default. {name} becomes the agent's name.">
          {(
            [
              ["staticCorePrompt", "Core (identity, environment, guardrails, behavior, formatting, cost)", 8],
              ["workWindowPrompt", "Work window (scheduled jobs)", 5],
              ["focusedChatPrompt", "Focused chat", 4],
              ["truncationMessage", "When the step limit is reached", 3],
            ] as const
          ).map(([field, label, rows]) => (
            <label key={field} className="block text-xs font-semibold">
              {label}
              <textarea
                name={field}
                key={`${field}:${settings[field] ?? ""}`}
                defaultValue={settings[field] ?? ""}
                onBlur={(e) => {
                  if ((e.target.value || null) !== settings[field]) save({ [field]: e.target.value || null });
                }}
                rows={rows}
                placeholder="(the built-in default)"
                className={`${input} resize-y font-mono text-[11px]`}
              />
              <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">
                {settings[field] ? `${settings[field]!.length.toLocaleString()} characters` : "Using the default"}
              </span>
              <FieldError msg={err(field)} />
            </label>
          ))}
        </Section>
      );

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
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField s={s} settings={settings} field="maxAgentSteps" label="Tool steps per turn" />
            <NumberField s={s} settings={settings} field="maxActionsPerHour" label="Actions per hour" />
            <NumberField s={s} settings={settings} field="commandTimeoutSec" label="Command timeout (seconds)" />
            <NumberField s={s} settings={settings} field="toolRetries" label="Retries when a tool fails" help="1 second apart." />
            <NumberField s={s} settings={settings} field="minGapMinutes" label="Gap between work sessions (min)" />
            <NumberField s={s} settings={settings} field="maxSessionsPerDay" label="Autonomous sessions per day" />
            <NumberField s={s} settings={settings} field="maxSessionMinutes" label="Longest work session (min)" />
            <NumberField s={s} settings={settings} field="inputPricePerMTok" label="Input price per 1M tokens" step="0.01" />
            <NumberField s={s} settings={settings} field="outputPricePerMTok" label="Output price per 1M tokens" step="0.01" />
            <NumberField s={s} settings={settings} field="cacheHitInputPricePerMTok" label="Cached input price per 1M tokens" step="0.0001" help="DeepSeek caches prompt prefixes automatically." />
          </div>
          <TownBudgetField s={s} settings={settings} />
          <TextField
            s={s}
            settings={settings}
            field="workspaceDir"
            label="The agent's workspace"
            help="Its own folder to play in: always low risk. Not the filesystem root, a system folder, your home folder itself, or this framework's folder."
          />
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
        </div>
      )}
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
      title="Free time"
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
        Today&apos;s cap: {settings.maxSessionsPerDay} autonomous sessions, at least {settings.minGapMinutes} min apart.
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
  field: "agentName" | "workspaceDir" | "bedtime" | "wakeTime";
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

// What the whole village may spend in a day (#60); empty = no town cap.
function TownBudgetField({ s, settings }: { s: Settings; settings: SettingsRow }) {
  const error = s.fieldErrors.townDailyBudgetUsd;
  const saved = settings.townDailyBudgetUsd == null ? "" : String(settings.townDailyBudgetUsd);
  const [draft, setDraft] = useDraft(saved, error);
  const commit = () => {
    if (draft === saved) s.clearFieldError("townDailyBudgetUsd");
    else void s.save({ townDailyBudgetUsd: draft.trim() === "" ? null : Number(draft) });
  };
  return (
    <label className="block text-xs font-semibold">
      The village&apos;s daily budget (USD)
      <input
        type="number"
        name="townDailyBudgetUsd"
        min={0}
        step="0.01"
        value={draft}
        placeholder="No town budget"
        aria-invalid={Boolean(error)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className={`${input} ${error ? "border-[#b3261e]" : ""}`}
      />
      <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">
        When everyone together has spent this today, every villager stops until midnight. Each villager can also have a budget of their own (Villagers).
      </span>
      <FieldError msg={error} />
    </label>
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
