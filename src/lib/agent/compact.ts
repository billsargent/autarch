import { db } from "@/db";
import { conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import type OpenAI from "openai";
import type { AgentSettingsRow } from "./settingsStore";
import { historyToApiMessages, type HistoryRow } from "./messageHistory";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Rough token estimator. DeepSeek docs (quick_start/token_usage) say ~1 English
// char ≈ 0.3 token (≈3.3 chars/token). 4 chars/token under-estimated real usage
// by ~18%, so compaction was triggering later than the real token budget.
const CHAR_PER_TOKEN = 3.3;
const PROMPT_OVERHEAD_TOKENS = 8000; // realistic system prompt + tools + framing
const SUMMARY_BATCH_TOKENS = 30000;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHAR_PER_TOKEN);
}

function rowTokens(r: HistoryRow): number {
  let n = estimateTokens(r.content ?? "");
  if (r.role === "assistant" && Array.isArray(r.toolCalls)) {
    try {
      n += estimateTokens(JSON.stringify(r.toolCalls));
    } catch {
      /* ignore */
    }
  }
  return n;
}

export function totalHistoryTokens(rows: HistoryRow[]): number {
  return rows.reduce((s, r) => s + rowTokens(r), 0);
}

// Pure windowing helper: pick the newest rows that fit within `targetTokens`
// (always keeping at least the newest message). Everything not returned is what
// gets summarized. Exposed for testing.
export function selectKeepWindow(rows: HistoryRow[], targetTokens: number): HistoryRow[] {
  const keep: HistoryRow[] = [];
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = rowTokens(rows[i]);
    if (used + t > targetTokens && keep.length > 0) break;
    keep.unshift(rows[i]);
    used += t;
  }
  return keep;
}

export interface CompactionSplit {
  keep: HistoryRow[];
  toSummarize: HistoryRow[];
}

// Decide what stays verbatim vs what gets summarized. Any leading tool-result
// rows of the keep window are folded into the summarize set: they can only be
// the results of assistant tool_calls that were just summarized (a tool row
// always immediately follows its assistant tool_calls), and leaving them in
// `keep` would orphan them — the sanitizer would drop them and the outcome
// would be lost entirely. Exposed for testing.
export function splitForCompaction(rows: HistoryRow[], targetTokens: number): CompactionSplit {
  const keepRaw = selectKeepWindow(rows, targetTokens);
  let i = 0;
  while (i < keepRaw.length && keepRaw[i].role === "tool") i++;
  const extraSummarize = keepRaw.slice(0, i);
  const keep = keepRaw.slice(i);
  const keepIds = new Set(keep.map((r) => r.id));
  const toSummarize = [...rows.filter((r) => !keepIds.has(r.id)), ...extraSummarize];
  return { keep, toSummarize };
}

export interface BuildOptions {
  conversationId: number;
  rows: HistoryRow[];
  settings: AgentSettingsRow;
  client: OpenAI;
}

// Build the model-facing messages for a turn. If the history fits within the
// configured context budget this is a no-op (identical to today). If it has
// grown too large, keep the most recent messages that fit within
// compactTargetTokens and fold the older ones into a cached "[Earlier
// conversation summary]" user message. No DB rows are deleted, so the UI's
// scroll-back history is unaffected.
export async function buildPromptMessages(opts: BuildOptions): Promise<ChatMessageParam[]> {
  const { conversationId, rows, settings, client } = opts;
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

  let summary = "";
  try {
    summary = await generateSummary(client, settings.modelName, toSummarize);
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

async function generateSummary(client: OpenAI, model: string, rows: HistoryRow[]): Promise<string> {
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
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You summarize a conversation excerpt into dense bullet points. Preserve: topics discussed, actions/tools run (including tool names and arguments) and their outcomes, decisions made, unresolved issues, pending approvals, and the current task state. Be concise but information-dense. No preamble.",
        },
        { role: "user", content: text },
      ],
      max_tokens: chunks.length > 1 ? 800 : 1000,
      // Summarization doesn't need high-effort chain-of-thought; pin it low so
      // compaction calls stay cheap.
      reasoning_effort: "low",
      thinking: { type: "enabled" },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
      thinking?: { type: "enabled" | "disabled" };
    });
    const out = completion.choices[0]?.message?.content?.trim() ?? "";
    if (out) parts.push(out);
  }
  return parts.join("\n");
}
