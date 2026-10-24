import { NextResponse } from "next/server";
import { db, sqlite } from "@/db";
import { providerKeys, providers } from "@/db/schema";
import { DEFAULT_BASE_URL, PROVIDER_KINDS, kindOfUrl, listProviders, type ProviderKind } from "@/lib/agent/providers";
import { getSettings } from "@/lib/agent/settingsStore";

export const dynamic = "force-dynamic";

// The model providers (#61): the town's own (from Settings) and any others.
// Keys are never returned, only whether one is set.
export async function GET() {
  const town = await getSettings();
  const prices = sqlite
    .prepare("SELECT id, provider_id AS providerId, model, input_per_mtok AS input, output_per_mtok AS output, cache_hit_per_mtok AS cacheHit FROM model_prices ORDER BY provider_id, model")
    .all();
  return NextResponse.json({
    town: { name: "Town", kind: kindOfUrl(town.apiBaseUrl), baseUrl: town.apiBaseUrl, model: town.modelName, keySet: Boolean(town.apiKey) },
    providers: listProviders(),
    prices,
  });
}

// Add a provider.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) return NextResponse.json({ error: "name: is required." }, { status: 400 });
  if (!PROVIDER_KINDS.includes(body.kind)) return NextResponse.json({ error: `kind: must be one of ${PROVIDER_KINDS.join(", ")}.` }, { status: 400 });
  const kind = body.kind as ProviderKind;
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : DEFAULT_BASE_URL[kind];
  if (!/^https?:\/\//i.test(baseUrl)) return NextResponse.json({ error: "baseUrl: must start with http:// or https://." }, { status: 400 });
  const [row] = await db.insert(providers).values({ name, kind, baseUrl }).returning();
  if (typeof body.apiKey === "string" && body.apiKey.trim()) await db.insert(providerKeys).values({ providerId: row.id, apiKey: body.apiKey.trim() });
  return NextResponse.json({ provider: { id: row.id, name, kind, baseUrl, keySet: Boolean(body.apiKey) } });
}
