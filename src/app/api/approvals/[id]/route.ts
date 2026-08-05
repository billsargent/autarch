import { NextResponse } from "next/server";
import { resolveApproval } from "@/lib/agent/runner";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const decision = body.decision === "denied" ? "denied" : "approved";
    const note = typeof body.note === "string" ? body.note : undefined;
    const result = await resolveApproval(Number(id), decision, note);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
