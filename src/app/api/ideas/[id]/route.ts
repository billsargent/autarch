import { NextResponse } from "next/server";
import { IdeaError, adoptNow, callVote, veto } from "@/lib/agent/ideas";

type Params = { params: Promise<{ id: string }> };

// The owner puts an idea to the vote, adopts it straight away, or vetoes it.
export async function PATCH(req: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "vote") await callVote(id);
    else if (body.action === "adopt") await adoptNow(id);
    else if (body.action === "veto") await veto(id);
    else return NextResponse.json({ error: "action: must be vote, adopt or veto." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof IdeaError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
