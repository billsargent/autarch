// A fake model server for tests: speaks enough of the chat-completions
// protocol (streaming and not) for real agent turns to run against it. Each
// request takes the next scripted reply and is recorded, so tests can check
// what the model was sent (system prompt, model name, tools offered).
import http from "node:http";

export type Reply =
  | { text: string }
  | { tools: Array<{ name: string; args: Record<string, unknown>; bare?: boolean }> }
  | { hang: true };

export interface SeenRequest {
  stream: boolean;
  model: string;
  system: string;
  tools: string[];
}

function chunk(delta: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta }], ...extra })}\n\n`;
}

export function startFakeModel() {
  const script: Reply[] = [];
  const seen: SeenRequest[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const stream = Boolean(parsed.stream);
      seen.push({
        stream,
        model: parsed.model,
        system: parsed.messages?.[0]?.role === "system" ? parsed.messages[0].content : "",
        tools: (parsed.tools ?? []).map((t: { function: { name: string } }) => t.function.name),
      });
      const reply = script.shift() ?? { text: "ok" };
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      if (!stream) {
        res.setHeader("content-type", "application/json");
        const text = "text" in reply ? reply.text : "summary";
        res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage }));
        return;
      }
      res.setHeader("content-type", "text/event-stream");
      if ("hang" in reply) {
        res.write(chunk({ role: "assistant", content: "" }));
        return; // never finishes; the client must abort
      }
      if ("text" in reply) {
        res.write(chunk({ role: "assistant", content: reply.text }));
      } else {
        reply.tools.forEach((t, i) => {
          // "bare" calls leave out type and id, as some providers' deltas do.
          const head = t.bare
            ? { index: i, function: { name: t.name, arguments: "" } }
            : { index: i, id: `call_${i}`, type: "function", function: { name: t.name, arguments: "" } };
          res.write(chunk({ role: "assistant", tool_calls: [head] }));
          res.write(chunk({ tool_calls: [{ index: i, function: { arguments: JSON.stringify(t.args) } }] }));
        });
      }
      res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [], usage })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  return {
    script,
    seen,
    // The last streamed (main) request: what a turn's step was sent.
    lastStep: () => [...seen].reverse().find((s) => s.stream),
    listen: () =>
      new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port))),
    close: () => server.close(),
  };
}
