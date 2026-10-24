import { NextResponse } from "next/server";
import { decline, hire } from "@/lib/agent/hiring";

type Params = { params: Promise<{ id: string }> };

// The owner decides a hire request (#99): approve (optionally editing the
// draft first) or decline. Only the owner can reach this API; the villagers'
// tools can't.
export async function PATCH(req: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  if (body.action === "decline") {
    const res = await decline(id);
    return "error" in res ? NextResponse.json({ error: res.error }, { status: 409 }) : NextResponse.json({ ok: true });
  }
  if (body.action !== "approve") return NextResponse.json({ error: "action: must be approve or decline." }, { status: 400 });
  const edits = body.draft && typeof body.draft === "object" ? body.draft : undefined;
  const res = await hire(id, "owner", edits);
  return "error" in res ? NextResponse.json({ error: res.error }, { status: 409 }) : NextResponse.json({ agent: res.agent });
}
