import { NextResponse } from "next/server";
import { runAgentTurn, type AgentEvent } from "@/lib/agent/runner";
import { isDeepSeekConfigured } from "@/lib/agent/deepseekClient";
import { getSettings } from "@/lib/agent/settingsStore";

export async function POST(req: Request) {
  const settings = await getSettings();
  if (!isDeepSeekConfigured(settings)) {
    return NextResponse.json(
      { error: "No DeepSeek API key is configured. Add one in Settings." },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const { conversationId, message } = body as { conversationId?: number; message: string };
  if (!message || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Stream progress events (SSE) so the UI can show the agent working in
  // real time instead of hanging silently until the whole turn finishes.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* stream closed */
        }
      };
      try {
        const result = await runAgentTurn({ conversationId, userMessage: message }, send);
        send({ type: "done", conversationId: result.conversationId });
        controller.close();
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
