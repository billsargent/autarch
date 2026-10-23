// Tests for per-conversation chat mode (src/lib/agent/chatMode.ts): the
// tool-access decision must follow each conversation's own mode, and only
// direct human chat is ever tool-less. Run with: npm run test:chatmode
import { isChatMode, resolveToolAccess, type ChatMode } from "../src/lib/agent/chatMode";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`✓ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
}

// Two conversations side by side: switching one must not affect the other.
const conversations: Array<{ id: number; chatMode: ChatMode }> = [
  { id: 1, chatMode: "agentic" },
  { id: 2, chatMode: "conversation" },
];
const access = (chatMode: ChatMode, isDirectChat = true, toolCount = 5) =>
  resolveToolAccess({ isDirectChat, chatMode, toolCount });

check("agentic conversation gets tools", access(conversations[0].chatMode), {
  toolsAvailable: true,
  toolsForbidden: false,
});
check("conversation-mode conversation gets no tools", access(conversations[1].chatMode), {
  toolsAvailable: false,
  toolsForbidden: true,
});
check("each conversation decides independently", conversations.map((c) => access(c.chatMode).toolsAvailable), [
  true,
  false,
]);
check("approval/scheduled turns keep tools even in conversation mode", access("conversation", false), {
  toolsAvailable: true,
  toolsForbidden: false,
});
check("no enabled tools means none available, but not forbidden", access("agentic", true, 0), {
  toolsAvailable: false,
  toolsForbidden: false,
});

check("isChatMode accepts agentic", isChatMode("agentic"), true);
check("isChatMode accepts conversation", isChatMode("conversation"), true);
check("isChatMode rejects other strings", isChatMode("chat"), false);
check("isChatMode rejects non-strings", isChatMode(undefined), false);

if (failures > 0) {
  console.error(`\n${failures} chat-mode test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll chat-mode tests passed.");
