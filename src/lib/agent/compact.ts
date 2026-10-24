import { db } from "@/db";
import { conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import type OpenAI from "openai";
import type { AgentSettingsRow } from "./settingsStore";
import { historyToApiMessages, type HistoryRow } from "./messageHistory";
import { rowTokens, splitForCompaction, totalHistoryTokens } from "./compactWindow";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// The pure helpers live in compactWindow.ts (no database access, so tests can
// import them safely); re-exported here for existing callers.
export { estimateTokens, selectKeepWindow, splitForCompaction, totalHistoryTokens, type CompactionSplit } from "./compactWindow";

const PROMPT_OVERHEAD_TOKENS = 8000; // realistic system prompt + tools + framing
const SUMMARY_BATCH_TOKENS = 30000;

export interface BuildOptions {
  conversationId: number;
  rows: HistoryRow[];
  settings: AgentSettingsRow;
  client: OpenAI;
  // Aborts the summary call when the turn is stopped.
  signal?: AbortSignal;
  // Told the tokens of every summary call, so the session counts them (#30).
  onUsage?: (usage: OpenAI.Completions.CompletionUsage) => void;
}

// Build the model-facing messages for a turn. If the history fits within the
// configured context budget this is a no-op (identical to today). If it has
// grown too large, keep the most recent messages that fit within
// compactTargetTokens and fold the older ones into a cached "[Earlier
// conversation summary]" user message. No DB rows are deleted, so the UI's
// scroll-back history is unaffected.
export async function buildPromptMessages(opts: BuildOptions): Promise<ChatMessageParam[]> {
  const { conversationId, rows, settings, client, signal, onUsage } = opts;
  const full = historyToApiMessages(rows);
  if (!settings.autoCompact) return full;

  const maxContext = Math.max(2000, settings.maxContextTokens ?? 24000);
  const target = Math.max(500, settings.compactTargetTokens ?? 9000);
  const total = totalHistoryTokens(rows);
  if (total + PROMPT_OVERHEAD_TOKENS <= maxContext) return full;

  // Keep the newest messages that fit within `target`; summarize everything older.
  const { keep, toSummarize } = splitForCompaction(rows, target);
  if (!toSummarize.length) return full;

  const newestToSummarizeId = toSummarize[toSummarize.length - 1].id;

  // Reuse the cached summary when it already covers everything being summarized.
  const convoRows = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  const convo = convoRows[0];
  if (convo?.summary && (convo.compactedThroughId ?? 0) >= newestToSummarizeId) {
    return [{ role: "user", content: `[Earlier conversation summary]\n${convo.summary}` }, ...historyToApiMessages(keep)];
  }

  // Only what the last summary didn't cover, merged with it (#31).
  const previous = convo?.summary && convo.compactedThroughId ? convo.summary : null;
  const fresh = previous ? toSummarize.filter((r) => r.id > (convo!.compactedThroughId ?? 0)) : toSummarize;

  let summary = "";
  try {
    summary = await generateSummary(client, settings.modelName, fresh, signal, previous, onUsage);
  } catch {
    // Safe fallback: hard window + truncation note rather than a giant prompt.
    return [
      {
        role: "user",
        content: "[Earlier conversation history was truncated to fit the context window; older messages are not shown.]",
      },
      ...historyToApiMessages(keep),
    ];
  }

  await db
    .update(conversations)
    .set({ summary, compactedThroughId: newestToSummarizeId, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return [{ role: "user", content: `[Earlier conversation summary]\n${summary}` }, ...historyToApiMessages(keep)];
}

// Each summary call is time-boxed and stops with the turn.
const SUMMARY_TIMEOUT_MS = 120_000;

async function generateSummary(
  client: OpenAI,
  model: string,
  rows: HistoryRow[],
  signal?: AbortSignal,
  previous?: string | null,
  onUsage?: BuildOptions["onUsage"],
): Promise<string> {
  // Cluster-aware chunking: never split between an assistant tool_calls message
  // and its tool result rows. A `tool` row always stays in the current chunk with
  // its preceding assistant, so chunk boundaries only ever land after non-tool rows.
  const chunks: HistoryRow[][] = [];
  let cur: HistoryRow[] = [];
  let curTokens = 0;
  for (const r of rows) {
    const t = rowTokens(r);
    if (cur.length && curTokens + t > SUMMARY_BATCH_TOKENS && r.role !== "tool") {
      chunks.push(cur);
      cur = [];
      curTokens = 0;
    }
    cur.push(r);
    curTokens += t;
  }
  if (cur.length) chunks.push(cur);

  const parts: string[] = [];
  for (const chunk of chunks) {
    // Serialize directly from rows so the summary can see WHICH tool ran with
    // WHAT arguments (via historyToApiMessages the assistant tool_calls message
    // has empty content and tool rows lose their name/args).
    const text = chunk
      .map((r) => {
        const content = r.content ?? "";
        if (r.role === "tool") {
          const name = r.toolName ? `[${r.toolName}]` : "";
          let args = "";
          if (r.toolArgs) {
            try {
              args = ` args=${JSON.stringify(r.toolArgs)}`;
            } catch {
              /* ignore */
            }
          }
          return `tool${name}${args}: ${content}`;
        }
        if (r.role === "assistant" && Array.isArray(r.toolCalls)) {
          const calls = (r.toolCalls as Array<{ function?: { name?: string; arguments?: string } }>)
            .map((c) => `${c.function?.name ?? "?"}(${c.function?.arguments ?? ""})`)
            .join("; ");
          return `assistant(tool_calls: ${calls})`;
        }
        return `${r.role}: ${content}`;
      })
      .join("\n");
    // The first batch carries the earlier summary, so the new one replaces it.
    const input = previous && chunk === chunks[0] ? `[Summary of what came before]\n${previous}\n\n[What happened next]\n${text}` : text;
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You summarize a conversation excerpt into dense bullet points. Preserve: topics discussed, actions/tools run (including tool names and arguments) and their outcomes, decisions made, unresolved issues, pending approvals, and the current task state. Be concise but information-dense. No preamble.",
        },
        { role: "user", content: input },
      ],
      max_tokens: chunks.length > 1 ? 800 : 1000,
      // Summarization doesn't need high-effort chain-of-thought; pin it low so
      // compaction calls stay cheap.
      reasoning_effort: "low",
      thinking: { type: "enabled" },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
      thinking?: { type: "enabled" | "disabled" };
    }, { timeout: SUMMARY_TIMEOUT_MS, signal });
    if (completion.usage) onUsage?.(completion.usage);
    const out = completion.choices[0]?.message?.content?.trim() ?? "";
    if (out) parts.push(out);
  }
  return parts.join("\n");
}
