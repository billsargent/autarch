import { NextResponse } from "next/server";
import { requestCancel } from "@/lib/agent/turnLock";

// Stop the conversation's running turn, whichever process runs it (the web
// server for chat, the worker for jobs). The runner sees the request within a
// second, aborts the model call in flight and stops before any further tool
// runs.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const conversationId = Number(body.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }
  const stopping = requestCancel(conversationId);
  return NextResponse.json({ ok: true, stopping });
}
