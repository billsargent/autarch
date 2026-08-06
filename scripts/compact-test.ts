// Fixture test for the context-compaction logic (src/lib/agent/compact.ts).
// Verifies token estimation and the keep-window (what gets summarized vs kept).
// Run with: npm run test:compact
import { estimateTokens, totalHistoryTokens, selectKeepWindow } from "../src/lib/agent/compact";
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

// buildPromptMessages is exercised in integration; the pure logic above is the
// decision core.

if (failures > 0) {
  console.error(`\n${failures} compact test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll compact tests passed.");
