import { NextResponse } from "next/server";
import { ApprovalError, resolveApproval } from "@/lib/agent/runner";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // Only an explicit decision counts; anything else must never approve.
  const decision = body.decision;
  if (decision !== "approved" && decision !== "denied") {
    return NextResponse.json({ error: 'decision must be "approved" or "denied"' }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note : undefined;
  try {
    const result = await resolveApproval(Number(id), decision, note);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: err instanceof ApprovalError ? err.status : 500 });
  }
}
