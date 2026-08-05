import OpenAI from "openai";

let client: OpenAI | null = null;

// Full-key hash so two keys sharing a short prefix can't silently reuse the
// wrong cached client.
function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

export function isDeepSeekConfigured(settings?: { apiKey?: string | null }): boolean {
  return Boolean(settings?.apiKey);
}

export function getDeepSeekClient(opts?: {
  apiKey?: string | null;
  baseUrl?: string | null;
}): OpenAI {
  const apiKey = opts?.apiKey || "";
  const baseUrl = opts?.baseUrl || "https://api.deepseek.com";
  if (!apiKey) {
    throw new Error("No DeepSeek API key is configured. Enter one in Settings.");
  }
  // Cache per key+base URL so switching keys/base URLs in the UI takes effect immediately.
  const cacheKey = `${baseUrl}|${hashKey(apiKey)}`;
  const current = client as (OpenAI & { __cacheKey?: string }) | null;
  if (current && current.__cacheKey === cacheKey) {
    return current;
  }
  const fresh = new OpenAI({ apiKey, baseURL: baseUrl }) as OpenAI & { __cacheKey?: string };
  fresh.__cacheKey = cacheKey;
  client = fresh;
  return fresh;
}

export interface DeepSeekModelInfo {
  id: string;
  owned_by?: string;
}

export async function fetchDeepSeekModels(opts: {
  apiKey: string;
  baseUrl?: string | null;
}): Promise<DeepSeekModelInfo[]> {
  const baseUrl = (opts.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${opts.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek /models returned HTTP ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> };
  return data.data || [];
}
