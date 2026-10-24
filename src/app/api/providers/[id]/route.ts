import { NextResponse } from "next/server";
import { db, sqlite } from "@/db";
import { providerKeys, providers } from "@/db/schema";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

// Rename a provider, change its address, or set or clear its key.
export async function PATCH(req: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  const patch: Partial<typeof providers.$inferInsert> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 40);
  if (typeof body.baseUrl === "string") {
    if (!/^https?:\/\//i.test(body.baseUrl.trim())) return NextResponse.json({ error: "baseUrl: must start with http:// or https://." }, { status: 400 });
    patch.baseUrl = body.baseUrl.trim();
  }
  if (Object.keys(patch).length) await db.update(providers).set(patch).where(eq(providers.id, id));
  if (body.apiKey === null || body.apiKey === "") await db.delete(providerKeys).where(eq(providerKeys.providerId, id));
  else if (typeof body.apiKey === "string") {
    sqlite.prepare("INSERT INTO provider_keys (provider_id, api_key) VALUES (?, ?) ON CONFLICT(provider_id) DO UPDATE SET api_key = excluded.api_key").run(id, body.apiKey.trim());
  }
  return NextResponse.json({ ok: true });
}

// Remove a provider. Villagers and conversations on it go back to the town's.
export async function DELETE(_req: Request, { params }: Params) {
  const id = Number((await params).id);
  sqlite.prepare("UPDATE agents SET provider_id = NULL WHERE provider_id = ?").run(id);
  sqlite.prepare("UPDATE conversations SET provider_id = NULL, model = NULL WHERE provider_id = ?").run(id);
  sqlite.prepare("DELETE FROM model_prices WHERE provider_id = ?").run(id);
  await db.delete(providers).where(eq(providers.id, id));
  return NextResponse.json({ ok: true });
}
