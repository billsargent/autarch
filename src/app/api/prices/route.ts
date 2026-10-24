import { NextResponse } from "next/server";
import { sqlite } from "@/db";

// Prices per provider and model (#63), in USD per million tokens; provider 0
// is the town's own. A model with no price uses the town's prices (Limits).
export async function PUT(req: Request) {
  const b = await req.json().catch(() => ({}));
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000 ? v : null);
  const model = typeof b.model === "string" ? b.model.trim() : "";
  const input = num(b.input);
  const output = num(b.output);
  if (!model || input === null || output === null) return NextResponse.json({ error: "model, input and output (USD per million tokens) are required." }, { status: 400 });
  sqlite
    .prepare(
      `INSERT INTO model_prices (provider_id, model, input_per_mtok, output_per_mtok, cache_hit_per_mtok) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider_id, model) DO UPDATE SET input_per_mtok = excluded.input_per_mtok, output_per_mtok = excluded.output_per_mtok, cache_hit_per_mtok = excluded.cache_hit_per_mtok`,
    )
    .run(Number(b.providerId) || 0, model, input, output, num(b.cacheHit));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  sqlite.prepare("DELETE FROM model_prices WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
