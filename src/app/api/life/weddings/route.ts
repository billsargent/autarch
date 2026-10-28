import { NextResponse } from "next/server";
import { sqlite } from "@/db";
import { WED_AT, logLife } from "@/lib/agent/life";

export const dynamic = "force-dynamic";

// Couples who'd like to marry (#134): sweethearts deep in love. A wedding is
// the owner's to bless.
export async function GET() {
  const couples = sqlite
    .prepare(
      `SELECT r.a_id AS a, r.b_id AS b, x.name AS aName, y.name AS bName FROM relationships r
       JOIN agents x ON x.id = r.a_id JOIN agents y ON y.id = r.b_id
       WHERE r.status = 'sweetheart' AND r.romance >= ? AND x.status != 'dismissed' AND y.status != 'dismissed'`,
    )
    .all(WED_AT);
  return NextResponse.json({ couples });
}

// { a, b, action: "bless" | "not_yet" }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const [a, b] = [Number(body.a), Number(body.b)].sort((x, y) => x - y);
  const rel = sqlite.prepare("SELECT status, romance FROM relationships WHERE a_id = ? AND b_id = ?").get(a, b) as { status: string; romance: number } | undefined;
  if (!rel || rel.status !== "sweetheart" || rel.romance < WED_AT) return NextResponse.json({ error: "They haven't asked to marry." }, { status: 409 });
  const names = sqlite.prepare("SELECT id, name FROM agents WHERE id IN (?, ?)").all(a, b) as Array<{ id: number; name: string }>;
  const [na, nb] = [names.find((n) => n.id === a)?.name, names.find((n) => n.id === b)?.name];
  if (body.action === "bless") {
    sqlite.prepare("UPDATE relationships SET status = 'partner', updated_at = unixepoch() WHERE a_id = ? AND b_id = ?").run(a, b);
    // With a chapel (#189), they marry there, and the day lifts them both.
    const chapel = Boolean(sqlite.prepare("SELECT 1 FROM buildings WHERE kind = 'chapel' AND status = 'built'").get());
    if (chapel) sqlite.prepare("UPDATE villager_life SET company = MIN(100, company + 20), energy = MIN(100, energy + 10) WHERE agent_id IN (?, ?)").run(a, b);
    logLife("wedding", a, `${na} and ${nb} were married${chapel ? " at the chapel" : ""}, with the owner's blessing. The whole village came.`, b);
  } else if (body.action === "not_yet") {
    sqlite.prepare("UPDATE relationships SET romance = 60, updated_at = unixepoch() WHERE a_id = ? AND b_id = ?").run(a, b);
    logLife("romance", a, `${na} and ${nb} will wait a while before marrying.`, b);
  } else return NextResponse.json({ error: "action: bless or not_yet." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
