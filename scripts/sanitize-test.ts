// Fixture test for the chat-history sanitizer (src/lib/agent/messageHistory.ts).
// Verifies that replayed history always satisfies the API invariant:
// every assistant message with tool_calls is immediately followed by a tool
// response for each tool_call_id. Run with: npm run test:sanitizer
import { historyToApiMessages, type HistoryRow } from "../src/lib/agent/messageHistory";

type Msg = {
  role: string;
  content?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
  reasoning_content?: string;
};

// Throws unless every assistant(tool_calls) message is immediately followed by
// tool responses covering each tool_call_id (with nothing in between).
function assertValidPairing(messages: Msg[]): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const calls = (m.tool_calls as Array<{ id: string }> | undefined) ?? [];
    if (m.role !== "assistant" || calls.length === 0) continue;
    const pending = new Set(calls.map((c) => c.id));
    let j = i + 1;
    while (pending.size > 0) {
      const nxt = messages[j];
      if (!nxt || nxt.role !== "tool") {
        throw new Error(`unanswered tool_call_ids [${[...pending].join(",")}] after message ${i}`);
      }
      if (!nxt.tool_call_id || !pending.has(nxt.tool_call_id)) {
        throw new Error(`unexpected tool message tool_call_id="${nxt.tool_call_id}" after message ${i}`);
      }
      pending.delete(nxt.tool_call_id);
      j++;
    }
  }
}

let idCounter = 0;
function row(partial: Omit<Partial<HistoryRow>, "id"> & { role: HistoryRow["role"] }): HistoryRow {
  return { id: ++idCounter, content: null, ...partial } as HistoryRow;
}
const call = (id: string, name = "run_shell_command") => ({
  id,
  type: "function" as const,
  function: { name, arguments: "{}" },
});

let failures = 0;
function check(name: string, rows: HistoryRow[], expect: Msg[]) {
  const got = historyToApiMessages(rows) as unknown as Msg[];
  try {
    assertValidPairing(got);
  } catch (e) {
    console.error(`✗ ${name}: invalid pairing → ${(e as Error).message}`);
    failures++;
    return;
  }
  const sig = (m: Msg) => `${m.role}:${m.reasoning_content ? "R:" : ""}${(m.tool_call_id ?? m.content ?? "").slice(0, 32)}`;
  const gotSig = got.map(sig).join(" | ");
  const expSig = expect.map(sig).join(" | ");
  if (gotSig !== expSig) {
    console.error(`✗ ${name}\n   expected: ${expSig}\n   got:      ${gotSig}`);
    failures++;
    return;
  }
  console.log(`✓ ${name}`);
}

// 1. Normal tool turn: user -> assistant(tool_calls) -> tool -> assistant summary
check(
  "normal tool turn",
  [
    row({ role: "user", content: "hi" }),
    row({ role: "assistant", content: "", toolCalls: [call("call_a")] }),
    row({ role: "tool", toolCallId: "call_a", content: "done" }),
    row({ role: "assistant", content: "summary" }),
  ],
  [
    { role: "user", content: "hi" },
    { role: "assistant", tool_calls: [call("call_a")] },
    { role: "tool", tool_call_id: "call_a", content: "done" },
    { role: "assistant", content: "summary" },
  ],
);

// 1b. Tool-call assistant rows keep their chain-of-thought. DeepSeek requires
// reasoning_content to be passed back on tool turns (requests carrying `tools`);
// plain assistant rows omit it.
check(
  "tool_calls assistant keeps reasoning_content",
  [
    row({ role: "user", content: "hi" }),
    row({ role: "assistant", content: "", reasoning: "need to check the disk first", toolCalls: [call("call_a")] }),
    row({ role: "tool", toolCallId: "call_a", content: "done" }),
    row({ role: "assistant", content: "summary" }),
  ],
  [
    { role: "user", content: "hi" },
    { role: "assistant", reasoning_content: "need to check the disk first", tool_calls: [call("call_a")] },
    { role: "tool", tool_call_id: "call_a", content: "done" },
    { role: "assistant", content: "summary" },
  ],
);

// 2. Interleaved notify_human/post_message assistant row (the deterministic 400 bug):
// assistant(tool_calls) -> assistant(plain) -> tool. The plain assistant row must
// be deferred until after the tool response.
check(
  "interleaved notify_human/post_message",
  [
    row({ role: "assistant", content: "", toolCalls: [call("call_a")] }),
    row({ role: "assistant", content: "📣 Notification posted" }),
    row({ role: "tool", toolCallId: "call_a", content: "ran" }),
  ],
  [
    { role: "assistant", tool_calls: [call("call_a")] },
    { role: "tool", tool_call_id: "call_a", content: "ran" },
    { role: "assistant", content: "📣 Notification posted" },
  ],
);

// 3. Interleave between two calls in a single assistant message.
check(
  "interleave between two calls",
  [
    row({ role: "assistant", content: "", toolCalls: [call("call_a"), call("call_b")] }),
    row({ role: "tool", toolCallId: "call_a", content: "result a" }),
    row({ role: "assistant", content: "posted mid" }),
    row({ role: "tool", toolCallId: "call_b", content: "result b" }),
  ],
  [
    { role: "assistant", tool_calls: [call("call_a"), call("call_b")] },
    { role: "tool", tool_call_id: "call_a", content: "result a" },
    { role: "tool", tool_call_id: "call_b", content: "result b" },
    { role: "assistant", content: "posted mid" },
  ],
);

// 4. Orphaned assistant(tool_calls) with no tool response (interrupted turn):
// a placeholder tool response must be synthesized.
check(
  "orphaned assistant tool_calls gets placeholder",
  [
    row({ role: "assistant", content: "", toolCalls: [call("call_a")] }),
    row({ role: "user", content: "next message" }),
  ],
  [
    { role: "assistant", tool_calls: [call("call_a")] },
    { role: "tool", tool_call_id: "call_a", content: "[tool result unavailable" },
    { role: "user", content: "next message" },
  ],
);

// 5. Orphaned tool row with no matching assistant tool_calls must be dropped.
check(
  "orphaned tool row dropped",
  [
    row({ role: "tool", toolCallId: "call_zzz", content: "stray" }),
    row({ role: "user", content: "hi" }),
  ],
  [{ role: "user", content: "hi" }],
);

// 6. Tool row with an empty tool_call_id must be dropped, others kept.
check(
  "empty tool_call_id dropped",
  [
    row({ role: "assistant", content: "", toolCalls: [call("call_a")] }),
    row({ role: "tool", toolCallId: "", content: "bad" }),
    row({ role: "tool", toolCallId: "call_a", content: "good" }),
  ],
  [
    { role: "assistant", tool_calls: [call("call_a")] },
    { role: "tool", tool_call_id: "call_a", content: "good" },
  ],
);

// 7. Multiple orphaned assistant groups back to back each get placeholders.
check(
  "multiple orphaned groups",
  [
    row({ role: "assistant", content: "", toolCalls: [call("call_a")] }),
    row({ role: "user", content: "m1" }),
    row({ role: "assistant", content: "", toolCalls: [call("call_b")] }),
    row({ role: "user", content: "m2" }),
  ],
  [
    { role: "assistant", tool_calls: [call("call_a")] },
    { role: "tool", tool_call_id: "call_a", content: "[tool result unavailable" },
    { role: "user", content: "m1" },
    { role: "assistant", tool_calls: [call("call_b")] },
    { role: "tool", tool_call_id: "call_b", content: "[tool result unavailable" },
    { role: "user", content: "m2" },
  ],
);

// 8. Event rows become user-prefixed messages and keep their position.
check(
  "event rows preserved",
  [
    row({ role: "user", content: "hi" }),
    row({ role: "event", content: "something happened" }),
    row({ role: "assistant", content: "", toolCalls: [call("call_a")] }),
    row({ role: "tool", toolCallId: "call_a", content: "ok" }),
  ],
  [
    { role: "user", content: "hi" },
    { role: "user", content: "[SYSTEM EVENT] something happened" },
    { role: "assistant", tool_calls: [call("call_a")] },
    { role: "tool", tool_call_id: "call_a", content: "ok" },
  ],
);

if (failures > 0) {
  console.error(`\n${failures} sanitizer test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll sanitizer tests passed.");
