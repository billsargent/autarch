import type OpenAI from "openai";

// Minimal shape of the stored chat rows the sanitizer needs, so it can be unit
// tested without pulling in the database.
export type HistoryRow = {
  id: number;
  role: "system" | "user" | "assistant" | "tool" | "event";
  content: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  toolArgs?: unknown;
  toolCalls?: unknown;
};

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Convert stored chat rows into API messages. The API enforces a strict rule:
// an assistant message with `tool_calls` MUST be immediately followed by a
// `tool` response for every `tool_call_id`. Broken history — from a turn that
// was interrupted mid-tool, or from tools like post_message/notify_human that
// insert assistant rows mid-turn between a tool_calls message and its tool
// responses — would otherwise trigger the 400 "insufficient tool messages
// following tool_calls message". This sanitizer repairs the ordering on replay:
//   - every assistant(tool_calls) message is immediately followed by its tool
//     responses (in order);
//   - user/event/plain-assistant rows that were interleaved between a tool_calls
//     message and its responses are deferred until after the responses so the
//     pairing stays intact;
//   - unanswered tool_call_ids get a synthesized placeholder response;
//   - orphaned tool messages (no matching pending tool_calls) are dropped.
export function historyToApiMessages(rows: HistoryRow[]): ChatMessageParam[] {
  const out: ChatMessageParam[] = [];
  let pendingIds = new Set<string>();
  const deferred: Array<() => void> = [];

  const emitUser = (content: string) => {
    const push = () => out.push({ role: "user", content } as ChatMessageParam);
    if (pendingIds.size > 0) deferred.push(push);
    else push();
  };
  const emitAssistant = (content: string) => {
    const push = () => out.push({ role: "assistant", content } as ChatMessageParam);
    if (pendingIds.size > 0) deferred.push(push);
    else push();
  };
  const closePending = () => {
    if (pendingIds.size > 0) {
      for (const id of pendingIds) {
        out.push({
          role: "tool",
          tool_call_id: id,
          content: "[tool result unavailable — the execution was interrupted before its result was recorded.]",
        } as ChatMessageParam);
      }
      pendingIds = new Set();
    }
    for (const emit of deferred) emit();
    deferred.length = 0;
  };

  for (const row of rows) {
    if (row.role === "tool") {
      const id = row.toolCallId || "";
      // Orphaned tool message (empty id, or no pending assistant tool_calls to
      // answer): sending it would fail API validation, so drop it.
      if (!id || !pendingIds.has(id)) continue;
      pendingIds.delete(id);
      out.push({ role: "tool", tool_call_id: id, content: row.content ?? "" } as ChatMessageParam);
    } else if (row.role === "assistant") {
      const toolCalls = (row.toolCalls as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null) || undefined;
      if (toolCalls && toolCalls.length) {
        closePending();
        out.push({
          role: "assistant",
          content: row.content ?? "",
          tool_calls: toolCalls,
        } as ChatMessageParam);
        pendingIds = new Set(toolCalls.map((c) => c.id));
      } else {
        emitAssistant(row.content ?? "");
      }
    } else if (row.role === "event") {
      emitUser(`[SYSTEM EVENT] ${row.content ?? ""}`);
    } else {
      emitUser(row.content ?? "");
    }
  }
  closePending();
  return out;
}
