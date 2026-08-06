// Fixture test for the context-compaction logic (src/lib/agent/compact.ts).
// Verifies token estimation and the keep-window (what gets summarized vs kept).
// Run with: npm run test:compact
import { estimateTokens, totalHistoryTokens, selectKeepWindow, splitForCompaction } from "../src/lib/agent/compact";
import { type HistoryRow } from "../src/lib/agent/messageHistory";

let idCounter = 0;
function row(partial: Omit<Partial<HistoryRow>, "id"> & { role: HistoryRow["role"] }): HistoryRow {
  return { id: ++idCounter, content: null, ...partial } as HistoryRow;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

// estimateTokens: ~4 chars/token
check("estimateTokens empty", estimateTokens("") === 0);
check("estimateTokens 'hello'", estimateTokens("hello") === 2); // ceil(5/4)
check("estimateTokens 1000 chars", estimateTokens("a".repeat(1000)) === 250);

// totalHistoryTokens sums content across rows
const rows = [
  row({ role: "user", content: "a".repeat(400) }), // 100 tokens
  row({ role: "assistant", content: "b".repeat(200) }), // 50 tokens
];
check("totalHistoryTokens", totalHistoryTokens(rows) === 150);

// selectKeepWindow: under target -> everything kept
check("keep all when small", selectKeepWindow([row({ role: "user", content: "x".repeat(400) })], 1000).length === 1);

// selectKeepWindow: keeps the newest that fit within target (each row = 100 tokens)
const many = Array.from({ length: 10 }, (_, i) => row({ role: "user", content: "z".repeat(400) }));
const kept = selectKeepWindow(many, 250);
check("keep newest within target", kept.length === 2, `got ${kept.length}`);
check("kept are the newest ids", kept[0].id === many[8].id && kept[1].id === many[9].id);

// selectKeepWindow: always keeps at least the newest message even if it exceeds target
const huge = [row({ role: "user", content: "q".repeat(4000) })]; // 1000 tokens
check("always keeps newest", selectKeepWindow(huge, 100).length === 1);

// ---------------------------------------------------------------------------
// splitForCompaction boundary tests (regression for the tool-result drop bug):
// if the keep/summarize boundary lands between an assistant tool_calls message
// and its tool result, the leading tool row must be folded into the summarize
// set so the outcome is not silently lost.
// ---------------------------------------------------------------------------

// Tool-call cluster straddling the boundary:
//   ids: 1:user 2:assistant 3:assistant(tool_calls, LARGE args) 4:tool 5:user(newest)
// target = 300: newest user (250) + tool (1) fit; the large assistant tool_calls
// (~238) pushes past the target -> boundary lands between it and its tool result,
// so keepRaw = [4:tool, 5:user] and the tool row must be folded into toSummarize.
const toolCall = { id: "call_a", type: "function", function: { name: "run_shell_command", arguments: "x".repeat(900) } };
const cluster = [
  row({ role: "user", content: "x".repeat(1000) }), // 250 tokens
  row({ role: "assistant", content: "y".repeat(400) }), // 100
  row({ role: "assistant", content: "", toolCalls: [toolCall] }), // tool_calls ~238
  row({ role: "tool", toolCallId: "call_a", toolName: "run_shell_command", toolArgs: { command: "x".repeat(900) }, content: "root" }), // 1
  row({ role: "user", content: "z".repeat(1000) }), // 250 (newest)
];
const split = splitForCompaction(cluster, 300);
check(
  "boundary: leading tool row folded into toSummarize",
  split.toSummarize.some((r) => r.role === "tool" && r.toolCallId === "call_a"),
  JSON.stringify(split.toSummarize.map((r) => `${r.role}:${r.id}`)),
);
check(
  "boundary: keep starts clean (no orphaned tool row)",
  split.keep.length > 0 && split.keep[0].role !== "tool",
  JSON.stringify(split.keep.map((r) => `${r.role}:${r.id}`)),
);
check(
  "boundary: assistant tool_calls + tool result both summarized",
  split.toSummarize.some((r) => r.role === "assistant" && Array.isArray(r.toolCalls)) &&
    split.toSummarize.some((r) => r.role === "tool"),
);
check("boundary: newest user kept", split.keep.some((r) => r.role === "user" && r.content === "z".repeat(1000)));

// Whole cluster fits in keep -> no tool rows folded (keep starts with a user).
const splitBig = splitForCompaction(cluster, 1200);
check(
  "cluster fully kept: no fold",
  splitBig.keep.length === cluster.length && splitBig.toSummarize.length === 0 && splitBig.keep[0].role === "user",
  JSON.stringify(splitBig.keep.map((r) => `${r.role}:${r.id}`)),
);

// Nothing to summarize -> empty toSummarize.
const splitTiny = splitForCompaction([row({ role: "user", content: "a".repeat(40) })], 1000);
check("small history: everything kept", splitTiny.toSummarize.length === 0 && splitTiny.keep.length === 1);

// buildPromptMessages is exercised in integration; the pure logic above is the
// decision core.

if (failures > 0) {
  console.error(`\n${failures} compact test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll compact tests passed.");
