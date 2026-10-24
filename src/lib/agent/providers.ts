import { sqlite } from "@/db";
import type { AgentSettingsRow } from "./settingsStore";

// Model providers (#61). The town's own provider is the one in Settings (base
// URL, key and model; DeepSeek unless changed). Owners can add more:
// OpenAI-compatible servers (OpenRouter, Ollama, LM Studio, OpenAI itself),
// Anthropic (through its OpenAI-compatible endpoint) and DeepSeek. A villager
// can use any of them, and a conversation can override its villager's model.
// Keys live in their own table that no API returns and no tool can read.

export type ProviderKind = "deepseek" | "openai" | "anthropic";
export const PROVIDER_KINDS: ProviderKind[] = ["deepseek", "openai", "anthropic"];
export const DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1/",
};

export interface ProviderRow {
  id: number;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
}

// What a turn runs with: the town settings, with the provider, key, model and
// prices of the villager (or the conversation's override) laid over them.
export type RunSettings = AgentSettingsRow & { providerKind: ProviderKind; providerName: string };

export function kindOfUrl(url: string | null | undefined): ProviderKind {
  return /deepseek/i.test(url ?? "") || !url ? "deepseek" : /anthropic/i.test(url) ? "anthropic" : "openai";
}

export function listProviders(): Array<ProviderRow & { keySet: boolean }> {
  const rows = sqlite.prepare("SELECT p.id, p.name, p.kind, p.base_url AS baseUrl, k.provider_id IS NOT NULL AS keySet FROM providers p LEFT JOIN provider_keys k ON k.provider_id = p.id ORDER BY p.id").all() as Array<ProviderRow & { keySet: number }>;
  return rows.map((r) => ({ ...r, keySet: Boolean(r.keySet) || Boolean(envKey(r.name)) }));
}

export function getProvider(id: number): ProviderRow | null {
  return (sqlite.prepare("SELECT id, name, kind, base_url AS baseUrl FROM providers WHERE id = ?").get(id) as ProviderRow | undefined) ?? null;
}

// AUTARCH_KEY_<NAME> overrides a stored key (e.g. AUTARCH_KEY_OPENROUTER).
function envKey(name: string): string | undefined {
  return process.env[`AUTARCH_KEY_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`] || undefined;
}

export function providerKey(p: ProviderRow): string | null {
  const stored = sqlite.prepare("SELECT api_key AS k FROM provider_keys WHERE provider_id = ?").get(p.id) as { k: string } | undefined;
  return envKey(p.name) ?? stored?.k ?? null;
}

// A price set for this provider (0 = the town's) and model, if any.
export function modelPrice(providerId: number, model: string) {
  return sqlite
    .prepare("SELECT input_per_mtok AS input, output_per_mtok AS output, cache_hit_per_mtok AS cacheHit FROM model_prices WHERE provider_id = ? AND model = ?")
    .get(providerId, model) as { input: number; output: number; cacheHit: number | null } | undefined;
}

export function resolveRun(
  town: AgentSettingsRow,
  agent: { providerId?: number | null; model?: string | null },
  conversation?: { providerId?: number | null; model?: string | null } | null,
): RunSettings {
  const providerId = conversation?.providerId ?? (conversation?.model ? null : agent.providerId) ?? null;
  const model = (conversation?.model?.trim() || (conversation?.providerId ? "" : agent.model?.trim()) || "").trim();
  const p = providerId ? getProvider(providerId) : null;
  const base: RunSettings = p
    ? { ...town, apiBaseUrl: p.baseUrl, apiKey: providerKey(p) ?? (p.kind === "openai" ? "none" : null), modelName: model || town.modelName, providerKind: p.kind, providerName: p.name }
    : { ...town, modelName: model || town.modelName, providerKind: kindOfUrl(town.apiBaseUrl), providerName: "Town" };
  const price = modelPrice(p?.id ?? 0, base.modelName);
  return price
    ? { ...base, inputPricePerMTok: price.input, outputPricePerMTok: price.output, cacheHitInputPricePerMTok: price.cacheHit ?? price.input }
    : base;
}

// The models a provider offers (its /models list).
export async function fetchModels(p: ProviderRow | null, town: AgentSettingsRow): Promise<string[]> {
  const kind = p?.kind ?? kindOfUrl(town.apiBaseUrl);
  const baseUrl = (p?.baseUrl ?? town.apiBaseUrl ?? DEFAULT_BASE_URL.deepseek).replace(/\/+$/, "");
  const key = p ? providerKey(p) : town.apiKey;
  const headers: Record<string, string> =
    kind === "anthropic" ? { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" } : key ? { authorization: `Bearer ${key}` } : {};
  const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`the provider's model list answered ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id: string }>; models?: Array<{ name: string }> };
  return (data.data?.map((m) => m.id) ?? data.models?.map((m) => m.name) ?? []).sort();
}
