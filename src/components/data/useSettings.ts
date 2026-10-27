"use client";

import { useCallback, useEffect, useState } from "react";
import type { SettingsRow } from "@/lib/agent/clientTypes";

// The agent's settings and the framework's fixed safeguards. Shared by the
// Settings page and the Mayor's ledger in the town hall.

export interface ToolInfo {
  name: string;
  description: string;
}

export interface HardSafeguards {
  protectedPaths: string[];
  protectedPackages: string[];
  protectedServices: string[];
  protectedProcesses: string[];
}

export const AUTONOMY_MODES = ["manual", "balanced", "autonomous", "unrestricted"] as const;

export const AUTONOMY_INFO: Record<(typeof AUTONOMY_MODES)[number], string> = {
  manual: "Only read-only / informational actions run automatically. Everything else waits for your approval.",
  balanced: "Low and medium risk actions run automatically. High-risk and critical actions still need your approval.",
  autonomous:
    "Low, medium, and high risk actions all run automatically. Critical actions (sudo, package removal, kill, service stop, etc.) STILL always require your approval — that safeguard can't be turned off.",
  unrestricted:
    "EVERYTHING runs automatically with NO approvals — destructive shell commands, sudo, package removal, killing processes, reading secrets, and modifying this framework. For risky testing only. You are fully responsible.",
};

export const UNRESTRICTED_MODE_WARNING =
  "Unrestricted mode disables ALL approvals and safety gates.\n\nThe agent will automatically execute every action — including sudo, package removal, killing processes, formatting disks, reading secrets, and modifying this framework — with NO human approval.\n\nGlobal Pause and the hourly action cap still apply.\n\nAre you absolutely sure?";

export const UNRESTRICTED_OVERRIDES_WARNING =
  "Enable unrestricted mode? The agent can then REQUEST every normally-blocked action — it still requires your explicit approval for each one.";

// The search key (#170) is written, never read back: the page only learns whether it's set.
export type SettingsPatch = Partial<SettingsRow> & { searchApiKey?: string | null };

export function useSettings() {
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [hard, setHard] = useState<HardSafeguards | null>(null);
  const [deepSeekConfigured, setDeepSeekConfigured] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The server names the field it refused ("maxAgentSteps: must be between…"),
  // so each error can be shown next to its field.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    const res = await fetch("/api/settings").then((r) => r.json());
    setSettings(res.settings);
    setTools(res.availableTools || []);
    setHard(res.hardSafeguards || null);
    setDeepSeekConfigured(res.deepSeekConfigured);
    setModels(res.settings?.deepseekModels || []);
  }, []);

  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  const save = useCallback(
    async (patch: SettingsPatch): Promise<boolean> => {
      if (!settings) return false;
      setSaving(true);
      setSaveError(null);
      const before = settings;
      setSettings({ ...settings, ...patch });
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          // Server-side guard: enabling unrestricted mode requires an explicit confirm flag.
          body: JSON.stringify(
            patch.unrestrictedMode === true || patch.autonomyMode === "unrestricted" ? { ...patch, confirm: true } : patch,
          ),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSettings(before); // revert the optimistic update
          const error: string = data.error || "Failed to save settings";
          setSaveError(error);
          const field = /^(\w+): (.*)$/.exec(error);
          if (field && field[1] in patch) setFieldErrors((prev) => ({ ...prev, [field[1]]: field[2] }));
          return false;
        }
        setSettings(data.settings);
        setSavedAt(Date.now());
        setFieldErrors((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(patch)) delete next[key];
          return next;
        });
        return true;
      } finally {
        setSaving(false);
      }
    },
    [settings],
  );

  // Saves the key (if given), then asks the API which models it offers.
  const testAndLoadModels = useCallback(
    async (apiKey: string, baseUrl: string): Promise<string> => {
      try {
        const res = await fetch("/api/deepseek/models", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: apiKey || undefined, baseUrl: baseUrl || undefined }),
        });
        const data = await res.json();
        if (!res.ok) return `error: ${data.error || "request failed"}`;
        setModels(data.models || []);
        setSettings((prev) =>
          prev ? { ...prev, deepseekModels: data.models || [], apiKeySet: true, apiBaseUrl: baseUrl || prev.apiBaseUrl } : prev,
        );
        return `loaded ${data.count ?? 0} model(s)`;
      } catch (e) {
        return `error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    [],
  );

  const clearFieldError = useCallback((field: string) => {
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const toggleTool = useCallback(
    (name: string) => {
      if (!settings) return;
      const enabled = new Set(settings.enabledTools);
      if (enabled.has(name)) enabled.delete(name);
      else enabled.add(name);
      void save({ enabledTools: Array.from(enabled) });
    },
    [settings, save],
  );

  const addProtectedPath = useCallback(
    (p: string) => {
      if (!settings || !p.trim()) return;
      void save({ extraProtectedPaths: [...settings.extraProtectedPaths, p.trim()] });
    },
    [settings, save],
  );

  const removeProtectedPath = useCallback(
    (p: string) => {
      if (!settings) return;
      void save({ extraProtectedPaths: settings.extraProtectedPaths.filter((x) => x !== p) });
    },
    [settings, save],
  );

  return {
    settings,
    tools,
    hard,
    deepSeekConfigured,
    models,
    saving,
    savedAt,
    saveError,
    fieldErrors,
    reload,
    save,
    clearFieldError,
    testAndLoadModels,
    toggleTool,
    addProtectedPath,
    removeProtectedPath,
  };
}
