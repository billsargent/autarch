// Chat mode is a per-conversation setting: "agentic" conversations may use
// tools, "conversation" ones answer from knowledge only. The global setting in
// agent_settings is just the default for newly created conversations.

export const CHAT_MODES = ["agentic", "conversation"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export function isChatMode(value: unknown): value is ChatMode {
  return typeof value === "string" && (CHAT_MODES as readonly string[]).includes(value);
}

// Decide whether a turn may use tools. Only a direct human chat message in a
// conversation-mode conversation is tool-less; scheduled, approval and other
// self-directed turns always keep their tools. `toolsForbidden` is the hard
// guarantee the runner enforces at execution time, even if a tool call
// somehow reaches it.
export function resolveToolAccess(opts: {
  isDirectChat: boolean;
  chatMode: ChatMode;
  toolCount: number;
}): { toolsAvailable: boolean; toolsForbidden: boolean } {
  const toolsForbidden = opts.isDirectChat && opts.chatMode === "conversation";
  return { toolsAvailable: opts.toolCount > 0 && !toolsForbidden, toolsForbidden };
}
