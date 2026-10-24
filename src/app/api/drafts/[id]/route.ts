import { NextResponse } from "next/server";
import { DraftError, decideDraft } from "@/lib/agent/drafts";

type Params = { params: Promise<{ id: string }> };

// The owner approves a draft (optionally with their edits) or discards it.
// Only the owner can reach this API; the villagers' tools can't.
export async function PATCH(req: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  if (body.action !== "approve" && body.action !== "discard") return NextResponse.json({ error: "action: must be approve or discard." }, { status: 400 });
  try {
    await decideDraft(id, body.action, typeof body.edits === "object" && body.edits ? body.edits : undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DraftError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
