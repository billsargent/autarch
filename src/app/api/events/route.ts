import { sqlite } from "@/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The live event stream (#74). Triggers in the database record every change
// to the tables the pages show (src/db/index.ts), whichever process made it
// (the web server or the worker); this streams the new rows to the browser
// as server-sent events, so pages refresh when something changes instead of
// polling on timers.

const TICK_MS = 700;
const PING_MS = 15_000;

interface EventRow {
  id: number;
  kind: string;
  ref: number | null;
  conversationId: number | null;
}

export async function GET(req: Request) {
  const resume = Number(req.headers.get("last-event-id"));
  let last = Number.isFinite(resume) && resume > 0 ? resume : (sqlite.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM events").get() as { m: number }).m;
  const read = sqlite.prepare("SELECT id, kind, ref, conversation_id AS conversationId FROM events WHERE id > ? ORDER BY id LIMIT 500");
  const encoder = new TextEncoder();
  let tick: ReturnType<typeof setInterval> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(tick);
    clearInterval(ping);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      send(`retry: 3000\n: connected\n\n`);
      tick = setInterval(() => {
        const rows = read.all(last) as EventRow[];
        if (!rows.length) return;
        last = rows[rows.length - 1].id;
        send(`id: ${last}\ndata: ${JSON.stringify(rows.map((r) => ({ kind: r.kind, ref: r.ref, conversationId: r.conversationId })))}\n\n`);
      }, TICK_MS);
      ping = setInterval(() => {
        send(`: ping\n\n`);
        // Keep the log short: a day of events is plenty for reconnects.
        sqlite.prepare("DELETE FROM events WHERE created_at < unixepoch() - 86400").run();
      }, PING_MS);
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel: stop,
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
