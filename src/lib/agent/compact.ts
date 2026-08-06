import { db } from "@/db";
import { conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import type OpenAI from "openai";
import type { AgentSettingsRow } from "./settingsStore";
import { historyToApiMessages, type HistoryRow } from "./messageHistory";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Rough token estimator (~4 chars/token for mixed English/code). Good enough
// for deciding when to compact; exact counts aren't required.
const CHAR_PER_TOKEN = 4;
const PROMPT_OVERHEAD_TOKENS = 2500; // system prompt + framing + tools
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
  const keep = selectKeepWindow(rows, target);
  const keepIds = new Set(keep.map((r) => r.id));
  const toSummarize = rows.filter((r) => !keepIds.has(r.id));
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
  // Chunk input so a single call stays within limits; concatenate the results.
  const chunks: HistoryRow[][] = [];
  let cur: HistoryRow[] = [];
  let curTokens = 0;
  for (const r of rows) {
    const t = rowTokens(r);
    if (cur.length && curTokens + t > SUMMARY_BATCH_TOKENS) {
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
    const text = historyToApiMessages(chunk)
      .map((m) => {
        const content = typeof m.content === "string" ? m.content : "";
        return `${m.role}${m.role === "tool" && m.tool_call_id ? `(${m.tool_call_id})` : ""}: ${content}`;
      })
      .join("\n");
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You summarize a conversation excerpt into dense bullet points. Preserve: topics discussed, actions/tools run and their outcomes, decisions made, unresolved issues, pending approvals, and the current task state. Be concise but information-dense. No preamble.",
        },
        { role: "user", content: text },
      ],
      max_tokens: chunks.length > 1 ? 800 : 1000,
    });
    const out = completion.choices[0]?.message?.content?.trim() ?? "";
    if (out) parts.push(out);
  }
  return parts.join("\n");
}
