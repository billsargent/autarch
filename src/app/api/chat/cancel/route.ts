import { NextResponse } from "next/server";
import { cancelTurn } from "@/lib/agent/runner";

// Cancel an in-flight agent turn on the server. The client aborts its SSE fetch
// after this so the runner actually stops (at the next step boundary / before
// further tool execution) instead of continuing to spend tokens.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const conversationId = Number(body.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }
  cancelTurn(conversationId);
  return NextResponse.json({ ok: true });
}
