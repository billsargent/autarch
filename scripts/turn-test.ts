// Tests for the turn lock, Stop and the runner fixes (#18–#21). Runs against
// a throwaway database (AUTARCH_DB_PATH) and a fake model server that speaks
// the chat-completions protocol, so real turns run without a real model.
// Run with: npm run test:turns
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const isChild = process.argv[2] === "child";
const tmp = isChild ? process.argv[3] : fs.mkdtempSync(path.join(os.tmpdir(), "autarch-turns-"));
process.env.AUTARCH_DB_PATH = path.join(tmp, "test.db");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`✓ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
}

// --- a fake model --------------------------------------------------------------
// Each request takes the next scripted reply. A reply is text, tool calls, or
// "hang" (stream nothing until the client goes away).
type Reply =
  | { text: string }
  | { tools: Array<{ name: string; args: Record<string, unknown>; bare?: boolean }> }
  | { hang: true };

const script: Reply[] = [];
const seen: Array<{ stream: boolean }> = [];
let lastSystemPrompt = "";

function chunk(delta: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta }], ...extra })}\n\n`;
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    const stream = Boolean(parsed.stream);
    seen.push({ stream });
    if (stream && parsed.messages?.[0]?.role === "system") lastSystemPrompt = parsed.messages[0].content;
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
        const head = t.bare ? { index: i, function: { name: t.name, arguments: "" } } : { index: i, id: `call_${i}`, type: "function", function: { name: t.name, arguments: "" } };
        res.write(chunk({ role: "assistant", tool_calls: [head] }));
        res.write(chunk({ tool_calls: [{ index: i, function: { arguments: JSON.stringify(t.args) } }] }));
      });
    }
    res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [], usage })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});

async function child() {
  // Claim conversation 1 and report whether this process won.
  const { claimTurn, TurnBusyError } = await import("../src/lib/agent/turnLock");
  try {
    claimTurn({ conversationId: 1, trigger: "chat" });
    console.log("WON");
  } catch (err) {
    console.log(err instanceof TurnBusyError ? "BUSY" : `ERROR ${err}`);
  }
  process.exit(0);
}

async function main() {
  const { db, sqlite } = await import("../src/db");
  const { conversations, messages, workSessions } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const lock = await import("../src/lib/agent/turnLock");
  const { runAgentTurn, TurnBusyError } = await import("../src/lib/agent/runner");
  const { updateSettings, getSettings } = await import("../src/lib/agent/settingsStore");

  await getSettings();
  const conv = async () => (await db.insert(conversations).values({ title: "t" }).returning())[0].id;
  const msgs = async (id: number) => db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.id);
  const session = async (id: number) => (await db.select().from(workSessions).where(eq(workSessions.id, id)))[0];

  // --- the lock (#18) -----------------------------------------------------------
  const c1 = await conv(); // id 1, for the child processes later
  const a = lock.claimTurn({ conversationId: c1, trigger: "chat" });
  let refused = false;
  try {
    lock.claimTurn({ conversationId: c1, trigger: "chat" });
  } catch (err) {
    refused = err instanceof lock.TurnBusyError;
  }
  check("a second turn in a busy conversation is refused", refused, true);
  check("…and the conversation reports busy", lock.isConversationBusy(c1), true);
  const c2 = await conv();
  const b = lock.claimTurn({ conversationId: c2, trigger: "chat" });
  check("another conversation isn't affected", b.id > a.id, true);

  const later = Date.now() + lock.ABANDONED_AFTER_MS + 5_000;
  check("a turn whose heartbeat went quiet doesn't hold the conversation", lock.isConversationBusy(c1, later), false);
  lock.heartbeat(a.id, later - 10_000);
  check("…but a fresh heartbeat does", lock.isConversationBusy(c1, later), true);
  const c = lock.claimTurn({ conversationId: c2, trigger: "chat", nowMs: later + lock.ABANDONED_AFTER_MS });
  check("claiming over an abandoned turn releases it", (await session(b.id)).status, "failed");
  check("…with a reason", (await session(b.id)).reason?.includes("stopped"), true);

  // --- Stop (#19) ---------------------------------------------------------------
  check("Stop asks the live turn", lock.requestCancel(c2), 1);
  check("…and the runner can see it", lock.isCancelRequested(c.id), true);
  sqlite.prepare("UPDATE work_sessions SET status = 'completed' WHERE id IN (?, ?)").run(a.id, c.id);
  const d = lock.claimTurn({ conversationId: c2, trigger: "chat", nowMs: Date.now() - 10 * 60_000 });
  check("Stop on a dead turn releases it at once", lock.requestCancel(c2), 0);
  check("…marking it failed", (await session(d.id)).status, "failed");

  // --- across processes: exactly one claim wins ---------------------------------
  sqlite.prepare("UPDATE work_sessions SET status = 'completed' WHERE conversation_id = ?").run(c1);
  const tsx = path.join("node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const results = await Promise.all(
    [0, 1, 2, 3].map(
      () =>
        new Promise<string>((resolve) => {
          const p = spawn(tsx, ["scripts/turn-test.ts", "child", tmp], { shell: process.platform === "win32" });
          let out = "";
          p.stdout.on("data", (d) => (out += d));
          p.on("close", () => resolve(out.trim().split("\n").pop() ?? ""));
        }),
    ),
  );
  check("four processes racing for one conversation: exactly one wins", results.sort(), ["BUSY", "BUSY", "BUSY", "WON"]);
  sqlite.prepare("UPDATE work_sessions SET status = 'completed' WHERE conversation_id = ?").run(c1);

  // --- real turns against the fake model ------------------------------------------
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const workspace = path.join(tmp, "ws");
  fs.mkdirSync(path.join(workspace, "adir"), { recursive: true });
  await updateSettings({
    apiKey: "test-key",
    apiBaseUrl: `http://127.0.0.1:${port}`,
    workspaceDir: workspace,
    autonomyMode: "autonomous",
    maxAgentSteps: 2,
    toolRetries: 1,
    paused: false,
  });

  // A refused turn writes nothing.
  const busyConv = await conv();
  const held = lock.claimTurn({ conversationId: busyConv, trigger: "chat" });
  let busyErr: unknown = null;
  try {
    await runAgentTurn({ conversationId: busyConv, userMessage: "hello" });
  } catch (err) {
    busyErr = err;
  }
  check("runAgentTurn on a busy conversation throws TurnBusyError", busyErr instanceof TurnBusyError, true);
  check("…and leaves no message behind", (await msgs(busyConv)).length, 0);
  sqlite.prepare("UPDATE work_sessions SET status = 'completed' WHERE id = ?").run(held.id);

  // #20: finishing cleanly on the last allowed step isn't a truncation.
  const t1 = await conv();
  script.push({ tools: [{ name: "list_directory", args: { path: "." } }] }, { text: "All done." });
  const events: string[] = [];
  await runAgentTurn({ conversationId: t1, userMessage: "look around" }, (e) => events.push(e.type));
  const t1msgs = await msgs(t1);
  check("a clean finish on the last step has no [TRUNCATED] event", t1msgs.some((m) => m.content?.startsWith("[TRUNCATED]")), false);
  check("…and no extra summary call", seen.filter((s) => !s.stream).length, 0);
  check("session_start is sent once (#21)", events.filter((e) => e === "session_start").length, 1);

  // #20: a truncated turn ends with exactly one closing message.
  const t2 = await conv();
  seen.length = 0;
  script.push(
    { tools: [{ name: "list_directory", args: { path: "." } }] },
    { tools: [{ name: "list_directory", args: { path: "adir" } }] },
    { text: "Here's where I got to." },
  );
  await runAgentTurn({ conversationId: t2, userMessage: "keep going" });
  const t2msgs = await msgs(t2);
  check("a turn cut off mid-task gets a [TRUNCATED] event", t2msgs.filter((m) => m.content?.startsWith("[TRUNCATED]")).length, 1);
  check("…and exactly one closing call", seen.filter((s) => !s.stream).length, 1);
  const lastAssistant = t2msgs.filter((m) => m.role === "assistant").pop();
  check("…which is the last word", lastAssistant?.content, "Here's where I got to.");

  // #21: tool-call deltas without type or id still run.
  const t3 = await conv();
  script.push({ tools: [{ name: "list_directory", args: { path: "." }, bare: true }] }, { text: "ok" });
  await runAgentTurn({ conversationId: t3, userMessage: "bare" });
  const toolRow = (await msgs(t3)).find((m) => m.role === "tool");
  check("a call with no type or id still runs", Boolean(toolRow?.content?.includes("adir")), true);
  check("…under a generated id", Boolean(toolRow?.toolCallId?.startsWith("call_")), true);

  // #21: a failing write is not retried; a failing read is.
  const t4 = await conv();
  script.push(
    {
      tools: [
        { name: "write_file", args: { path: "adir", content: "x" } },
        { name: "read_file", args: { path: "missing.txt" } },
      ],
    },
    { text: "ok" },
  );
  await runAgentTurn({ conversationId: t4, userMessage: "write" });
  const t4tools = (await msgs(t4)).filter((m) => m.role === "tool");
  const writeOut = t4tools.find((m) => m.toolName === "write_file")?.content ?? "";
  const readOut = t4tools.find((m) => m.toolName === "read_file")?.content ?? "";
  check("a failing write isn't retried", writeOut.startsWith("ERROR: "), true);
  check("a failing read is retried", readOut.startsWith("ERROR (after 1 retries)") || !readOut.startsWith("ERROR"), true);

  // #19: Stop through the database ends a turn that's waiting on the model.
  const t5 = await conv();
  script.push({ hang: true });
  const started = Date.now();
  const run = runAgentTurn({ conversationId: t5, userMessage: "think hard" });
  await new Promise((r) => setTimeout(r, 1500));
  lock.requestCancel(t5);
  await run;
  const t5msgs = await msgs(t5);
  check("Stop ends a turn stuck waiting on the model", t5msgs.some((m) => m.content?.startsWith("[CANCELLED]")), true);
  check("…within a few seconds", Date.now() - started < 8000, true);
  check("…and frees the conversation", lock.isConversationBusy(t5), false);
  check("…recording it as stopped, not completed", (await db.select().from(workSessions).where(eq(workSessions.conversationId, t5)))[0].status, "terminated");
  check("…with no empty reply saved", t5msgs.some((m) => m.role === "assistant"), false);

  // --- personality and tool restraint in the prompt the model gets ----------------
  const { DEFAULT_PERSONA } = await import("../src/lib/agent/persona");
  const p1 = await conv();
  script.push({ text: "Hello there!" });
  await runAgentTurn({ conversationId: p1, userMessage: "hi" });
  check("the default personality reaches the model", lastSystemPrompt.includes(DEFAULT_PERSONA), true);
  check("…with the tool-restraint rules", lastSystemPrompt.includes("Most messages need no tools at all"), true);
  check("…and no nudge to query the database about itself", /inspect your own usage|self-observation/.test(lastSystemPrompt), false);
  await updateSettings({ persona: "A grumpy old fisherman who loves puns." });
  script.push({ text: "Hmph." });
  await runAgentTurn({ conversationId: p1, userMessage: "hello again" });
  check("a custom personality replaces the default", [lastSystemPrompt.includes("grumpy old fisherman"), lastSystemPrompt.includes(DEFAULT_PERSONA)], [true, false]);

  server.close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* on Windows the database stays locked until exit */
  }
  if (failures > 0) {
    console.error(`\n${failures} turn test(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll turn tests passed.");
  process.exit(0);
}

(isChild ? child() : main()).catch((err) => {
  console.error(err);
  process.exit(1);
});
