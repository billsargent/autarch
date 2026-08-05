import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/agent/settingsStore";
import { fetchDeepSeekModels } from "@/lib/agent/deepseekClient";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const current = await getSettings();
    const apiKey =
      typeof body.apiKey === "string" && body.apiKey.trim()
        ? body.apiKey.trim()
        : (current.apiKey || "");
    const baseUrl =
      typeof body.baseUrl === "string" && body.baseUrl.trim()
        ? body.baseUrl.trim()
        : (current.apiBaseUrl || "https://api.deepseek.com");
    if (!apiKey) {
      return NextResponse.json({ error: "No API key provided or stored. Enter a key first." }, { status: 400 });
    }
    const models = await fetchDeepSeekModels({ apiKey, baseUrl });
    const ids = models.map((m) => m.id);
    const persist = body.persist !== false;
    if (persist) {
      await updateSettings({ apiKey, apiBaseUrl: baseUrl, deepseekModels: ids });
    }
    return NextResponse.json({ models: ids, count: ids.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}