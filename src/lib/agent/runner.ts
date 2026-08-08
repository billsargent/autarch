import { db } from "@/db";
import { conversations, messages, toolExecutions, workSessions } from "@/db/schema";
import { eq, asc, and, gte, inArray, sql as dsql } from "drizzle-orm";
import type OpenAI from "openai";
import { getDeepSeekClient } from "./deepseekClient";
import { buildPromptMessages } from "./compact";
import { getSettings, type AgentSettingsRow } from "./settingsStore";
import { buildSystemPrompt } from "./systemPrompt";
import { getEnabledToolDefinitions, evaluateToolRisk, extraProcessGuard, executeTool } from "./tools";
import { autonomyAllowsAuto, buildOverrides, type RiskLevel } from "./risk";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

type DeepSeekThinking = { thinking?: { type: "enabled" | "disabled" } };
type DeepSeekRequestParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & DeepSeekThinking;

// Apply token-cost controls to every model request: cap output per step and pin
// thinking mode/effort. DeepSeek V4 defaults to thinking mode with high effort,
// which spends a lot of output tokens on chain-of-thought on every step, so we
// default to low effort and a bounded max_tokens. `thinking` is a DeepSeek-only
// body field (not in the OpenAI SDK types); the SDK serializes it through.
function modelRequestParams(
  settings: AgentSettingsRow,
  base: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
): DeepSeekRequestParams {
  const params: DeepSeekRequestParams = {
    ...base,
    max_tokens: settings.maxOutputTokens,
    thinking: settings.thinkingEnabled ? { type: "enabled" } : { type: "disabled" },
  };
  if (settings.thinkingEnabled) {
    params.reasoning_effort = settings.reasoningEffort as "low" | "high" | "max";
  }
  return params;
}

interface StreamedMessage {
  content: string;
  reasoningContent: string;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null;
  usage: UsageLike | undefined;
  interrupted: boolean;
}

// Stream the main completion so a cancelled/timed-out turn can abort the request
// mid-generation (saving the output tokens the model would otherwise keep
// spending) and so the UI can show content as it arrives. Accumulates content,
// reasoning_content, and tool_calls deltas; usage comes from the final chunk via
// stream_options.include_usage. Breaking out of the async iterable makes the SDK
// abort the underlying request.
async function streamChatCompletion(
  client: OpenAI,
  settings: AgentSettingsRow,
  base: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  isInterrupted: () => boolean,
  onDelta?: (content: string, reasoning: string) => void,
): Promise<StreamedMessage> {
  const stream = await client.chat.completions.create({
    ...modelRequestParams(settings, base),
    stream: true,
    stream_options: { include_usage: true },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & DeepSeekThinking);

  let content = "";
  let reasoning = "";
  let usage: UsageLike | undefined;
  const toolAcc: Array<{ id?: string; type?: string; function: { name: string; arguments: string } }> = [];
  let interrupted = false;

  for await (const chunk of stream) {
    if (isInterrupted()) {
      interrupted = true;
      // Early return aborts the request, so the provider stops generating and we
      // stop being billed for the remaining output tokens.
      break;
    }
    const delta = chunk.choices[0]?.delta;
    if (delta) {
      if (delta.content) content += delta.content;
      const r = (delta as { reasoning_content?: string }).reasoning_content;
      if (r) reasoning += r;
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        toolAcc[idx] = toolAcc[idx] ?? { function: { name: "", arguments: "" } };
        if (tc.id) toolAcc[idx].id = tc.id;
        if (tc.type) toolAcc[idx].type = tc.type;
        if (tc.function?.name) toolAcc[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolAcc[idx].function.arguments += tc.function.arguments;
      }
    }
    if (chunk.usage) usage = chunk.usage as UsageLike;
    onDelta?.(content, reasoning);
  }

  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null = toolAcc.length
    ? (toolAcc as unknown as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[])
    : null;

  return { content, reasoningContent: reasoning, toolCalls, usage, interrupted };
}

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3, blocked: 4 };

function worseRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

// Conversations whose in-flight turn has been cancelled by the human (the Stop
// button). Checked at step boundaries so the server actually stops spending
// tokens / running tools instead of just closing the client's SSE stream.
// In-memory: covers chat turns in the web process (scheduled worker turns are
// time-boxed and not cancelable from the UI today).
const cancelledConversations = new Set<number>();
export function cancelTurn(conversationId: number) {
  cancelledConversations.add(conversationId);
}
export function isTurnCancelled(conversationId: number): boolean {
  return cancelledConversations.has(conversationId);
}

export async function ensureConversation(conversationId?: number | null) {
  if (conversationId) {
    const rows = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (rows.length) return rows[0];
  }
  const inserted = await db.insert(conversations).values({ title: "New session" }).returning();
  return inserted[0];
}

async function insertMessage(row: typeof messages.$inferInsert) {
  const inserted = await db.insert(messages).values(row).returning();
  return inserted[0];
}

async function loadHistory(conversationId: number) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.id));
}

async function countRecentActions(): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await db
    .select({ count: dsql<number>`count(*)` })
    .from(toolExecutions)
    .where(and(gte(toolExecutions.requestedAt, oneHourAgo), inArray(toolExecutions.status, ["success", "approved"])));
  return Number(rows[0]?.count ?? 0);
}

export type SessionTrigger = "chat" | "approval" | "scheduled" | "report";

// Progress events emitted (optionally) during a turn so the UI can stream a
// live view of the agent's activity instead of only getting a final payload.
export type AgentEvent =
  | { type: "session_start"; sessionId: number; toolsAvailable?: boolean; model?: string; chatMode?: string; toolsCount?: number }
  | { type: "step_start"; step: number; maxSteps: number }
  | { type: "model_reply"; step: number; content: string }
  | { type: "model_stream"; step: number; content: string; reasoning: string }
  | { type: "tool_start"; tool: string; args: Record<string, unknown>; executionId: number }
  | { type: "tool_result"; tool: string; status: string; executionId: number; output?: string }
  | { type: "done"; conversationId: number }
  | { type: "error"; message: string };

export interface ActiveSession {
  id: number;
  startedAt: Date;
  maxDurationMs: number;
  stepsUsed: number;
  actionsUsed: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  totalTokens: number;
  costUsd: number;
}

async function beginSession(
  trigger: SessionTrigger,
  opts: { jobId?: number | null; conversationId?: number | null; maxDurationMinutes?: number },
): Promise<ActiveSession> {
  const inserted = await db
    .insert(workSessions)
    .values({
      jobId: opts.jobId ?? null,
      conversationId: opts.conversationId ?? null,
      trigger,
    })
    .returning();
  const row = inserted[0];
  const maxDurationMinutes = opts.maxDurationMinutes ?? 10;
  return {
    id: row.id,
    startedAt: row.startedAt,
    maxDurationMs: Math.max(1, maxDurationMinutes) * 60_000,
    stepsUsed: 0,
    actionsUsed: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

// DeepSeek prices prompt tokens at a ~50x discount when they hit the automatic
// on-disk context cache. When the API reports cache-hit vs cache-miss tokens we
// bill them at their own rates; otherwise fall back to billing all prompt tokens
// at the (cache-miss) input price.
function usageCost(
  usage: UsageLike | undefined,
  inputPrice: number,
  outputPrice: number,
  cacheHitInputPrice: number,
): number {
  if (!usage) return 0;
  const miss = usage.prompt_cache_miss_tokens ?? usage.prompt_tokens ?? 0;
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const c = usage.completion_tokens ?? 0;
  return (miss / 1_000_000) * inputPrice + (hit / 1_000_000) * cacheHitInputPrice + (c / 1_000_000) * outputPrice;
}

function accumulateUsage(
  session: ActiveSession,
  usage: UsageLike | undefined,
  inputPrice: number,
  outputPrice: number,
  cacheHitInputPrice: number,
) {
  if (!usage) return;
  const p = usage.prompt_tokens ?? 0;
  const c = usage.completion_tokens ?? 0;
  session.promptTokens += p;
  session.completionTokens += c;
  session.cacheHitTokens += usage.prompt_cache_hit_tokens ?? 0;
  session.cacheMissTokens += usage.prompt_cache_miss_tokens ?? 0;
  session.totalTokens += usage.total_tokens ?? p + c;
  session.costUsd += usageCost(usage, inputPrice, outputPrice, cacheHitInputPrice);
}

async function finishSession(
  session: ActiveSession,
  status: "completed" | "terminated" | "failed" | "skipped",
  reason?: string,
) {
  await db
    .update(workSessions)
    .set({
      status,
      endedAt: new Date(),
      stepsUsed: session.stepsUsed,
      actionsUsed: session.actionsUsed,
      promptTokens: session.promptTokens,
      completionTokens: session.completionTokens,
      cacheHitTokens: session.cacheHitTokens,
      cacheMissTokens: session.cacheMissTokens,
      totalTokens: session.totalTokens,
      costUsd: Number(session.costUsd.toFixed(6)),
      reason: reason ?? null,
    })
    .where(eq(workSessions.id, session.id));
}

export interface AgentTurnResult {
  conversationId: number;
  newMessages: Array<typeof messages.$inferSelect>;
}

export async function runAgentTurn(opts: {
  conversationId?: number | null;
  userMessage?: string;
  eventNote?: string;
  trigger?: SessionTrigger;
  jobId?: number | null;
  maxDurationMinutes?: number;
}, onEvent?: (e: AgentEvent) => void): Promise<AgentTurnResult> {
  const conversation = await ensureConversation(opts.conversationId ?? undefined);
  const conversationId = conversation.id;
  cancelledConversations.delete(conversationId);
  const newMessages: Array<typeof messages.$inferSelect> = [];
  if (opts.userMessage) {
    const row = await insertMessage({ conversationId, role: "user", content: opts.userMessage });
    newMessages.push(row);
    if (conversation.title === "New session") {
      await db
        .update(conversations)
        .set({ title: opts.userMessage.slice(0, 60), updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    }
  }
  if (opts.eventNote) {
    const row = await insertMessage({ conversationId, role: "event", content: opts.eventNote });
    newMessages.push(row);
  }

  const settings = await getSettings();
  const overrides = buildOverrides(settings);
  const trigger: SessionTrigger = opts.trigger ?? (opts.jobId ? "scheduled" : "chat");
  const maxDurationMinutes = opts.maxDurationMinutes ?? settings.maxSessionMinutes;
  const session = await beginSession(trigger, {
    jobId: opts.jobId ?? null,
    conversationId,
    maxDurationMinutes,
  });

  const inputPrice = Number(settings.inputPricePerMTok) || 0.14;
  const outputPrice = Number(settings.outputPricePerMTok) || 0.28;
  const cacheHitPrice = Number(settings.cacheHitInputPricePerMTok) || 0.0028;
  const deadline = session.startedAt.getTime() + session.maxDurationMs;

  onEvent?.({ type: "session_start", sessionId: session.id });

  try {
    const client = getDeepSeekClient({ apiKey: settings.apiKey, baseUrl: settings.apiBaseUrl });
    const systemPrompt = await buildSystemPrompt(settings);
    const tools = getEnabledToolDefinitions(settings.enabledTools as string[]);

    const historyRows = await loadHistory(conversationId);
    const built = await buildPromptMessages({ conversationId, rows: historyRows, settings, client });
    const apiMessages: ChatMessageParam[] = [{ role: "system", content: systemPrompt }, ...built];

    const maxSteps = Math.max(1, settings.maxAgentSteps);
    // Direct user chat: in conversation mode we DON'T expose tools at all (a tool
    // call becomes impossible); in agentic mode tools are always "auto" — the
    // chat-mode toggle is the single explicit control. Scheduled, approval, and
    // self-directed turns always keep tools.
    const isDirectChat = Boolean(opts.userMessage) && !opts.jobId && !opts.trigger;
    const conversationMode = isDirectChat && settings.chatMode === "conversation";
    const toolsAvailable = tools.length > 0 && !conversationMode;
    // Hard guarantee: in conversation mode, no tool call is ever executed.
    const toolsForbidden = conversationMode;
    onEvent?.({
      type: "session_start",
      sessionId: session.id,
      toolsAvailable,
      model: settings.modelName,
      chatMode: settings.chatMode,
      toolsCount: tools.length,
    });
    if (process.env.DEBUG) {
      console.log(
        `[turn] trigger=${opts.trigger ?? (opts.jobId ? "scheduled" : "chat")} chatMode=${settings.chatMode} model=${settings.modelName} tools=${tools.length} available=${toolsAvailable} conversationDirect=${conversationMode}`,
      );
    }
    let terminated = false;
    let cancelled = false;
    let ranTools = false;
    let lastContentEmpty = true;

    for (let step = 0; step < maxSteps; step++) {
      if (Date.now() > deadline) {
        terminated = true;
        const row = await insertMessage({
          conversationId,
          role: "event",
          content: `[SESSION] Work session #${session.id} hit its ${maxDurationMinutes} minute time limit and was stopped.`,
        });
        newMessages.push(row);
        break;
      }

      if (isTurnCancelled(conversationId)) {
        cancelled = true;
        terminated = true;
        const row = await insertMessage({
          conversationId,
          role: "event",
          content: `[CANCELLED] The human stopped this turn. No further work will run.`,
        });
        newMessages.push(row);
        break;
      }

      onEvent?.({ type: "step_start", step: step + 1, maxSteps });

      const streamed = await streamChatCompletion(
        client,
        settings,
        {
          model: settings.modelName,
          messages: apiMessages,
          tools: toolsAvailable ? tools : undefined,
          tool_choice: toolsAvailable ? "auto" : undefined,
        },
        () => isTurnCancelled(conversationId) || Date.now() > deadline,
        (content, reasoning) => {
          // Live "thinking / generating" indicator in the UI while the model streams.
          onEvent?.({ type: "model_stream", step: step + 1, content, reasoning });
        },
      );

      // Cancelled / timed out mid-generation: abort the stream (done above) and
      // stop the turn instead of paying for the rest of the generation.
      if (streamed.interrupted) {
        if (isTurnCancelled(conversationId)) {
          cancelled = true;
          terminated = true;
          const row = await insertMessage({
            conversationId,
            role: "event",
            content: `[CANCELLED] The human stopped this turn. No further work will run.`,
          });
          newMessages.push(row);
        } else {
          terminated = true;
          const row = await insertMessage({
            conversationId,
            role: "event",
            content: `[SESSION] Work session #${session.id} hit its ${maxDurationMinutes} minute time limit and was stopped.`,
          });
          newMessages.push(row);
        }
        break;
      }

      const rawMsg = {
        content: streamed.content,
        reasoning_content: streamed.reasoningContent,
        tool_calls: streamed.toolCalls,
      } as OpenAI.Chat.Completions.ChatCompletionMessage & { reasoning_content?: string };
      const usage = streamed.usage;
      accumulateUsage(session, usage, inputPrice, outputPrice, cacheHitPrice);
      const callCost = usageCost(usage, inputPrice, outputPrice, cacheHitPrice);
      session.stepsUsed = step + 1;

      const assistantRow = await insertMessage({
        conversationId,
        role: "assistant",
        content: rawMsg.content ?? "",
        reasoning: rawMsg.reasoning_content ?? null,
        toolCalls: rawMsg.tool_calls ? JSON.parse(JSON.stringify(rawMsg.tool_calls)) : null,
        sessionId: session.id,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
        costUsd: callCost ? Number(callCost.toFixed(6)) : null,
      });
      newMessages.push(assistantRow);

      apiMessages.push({
        role: "assistant",
        content: rawMsg.content ?? "",
        ...(rawMsg.tool_calls?.length
          ? {
              tool_calls: rawMsg.tool_calls,
              // DeepSeek requires the assistant's chain-of-thought to be sent back
              // on tool-call turns (for requests carrying `tools`), or it returns a
              // 400 on the next step/turn.
              ...(rawMsg.reasoning_content ? { reasoning_content: rawMsg.reasoning_content } : {}),
            }
          : {}),
      } as ChatMessageParam);

      ranTools = ranTools || Boolean(rawMsg.tool_calls?.length);
      lastContentEmpty = !(rawMsg.content && rawMsg.content.trim().length > 0);
      onEvent?.({ type: "model_reply", step: step + 1, content: rawMsg.content ?? "" });

      if (!rawMsg.tool_calls || rawMsg.tool_calls.length === 0) {
        break;
      }

      for (const rawCall of rawMsg.tool_calls) {
        if (rawCall.type !== "function") continue;
        session.actionsUsed += 1;
        const call = rawCall as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
        const toolName = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }

        let resultContent = "";
        let status: typeof toolExecutions.$inferInsert.status = "success";
        let output = "";
        let risk = evaluateToolRisk(toolName, args, settings);

        if (toolName === "run_shell_command") {
          const guard = extraProcessGuard(String(args.command || ""), overrides);
          if (guard) risk = { risk: worseRisk(risk.risk, guard.risk), reason: `${risk.reason} ${guard.reason}` };
        }

        const enabledTools = settings.enabledTools as string[];
        const toolIsEnabled = enabledTools.includes(toolName);

        const execRow = await db
          .insert(toolExecutions)
          .values({
            conversationId,
            messageId: assistantRow.id,
            tool: toolName,
            input: args,
            riskLevel: risk.risk,
            riskReason: risk.reason,
            status: "success",
          })
          .returning();
        const execution = execRow[0];
        onEvent?.({ type: "tool_start", tool: toolName, args, executionId: execution.id });

        const mode = settings.autonomyMode as "manual" | "balanced" | "autonomous" | "unrestricted";
        const unrestricted = mode === "unrestricted";

        if (toolsForbidden) {
          status = "blocked";
          output = "Tools are disabled in conversation mode. The agent cannot act until the human switches to agentic mode.";
          resultContent = `BLOCKED (conversation mode): ${output}`;
        } else if (settings.paused) {
          status = "blocked";
          output = "The human has globally PAUSED the agent. No actions run while paused.";
          resultContent = `PAUSED: ${output}`;
        } else if (!unrestricted && !toolIsEnabled) {
          status = "blocked";
          output = `This tool ("${toolName}") is currently disabled in the agent's settings.`;
          resultContent = `BLOCKED: ${output}`;
        } else if (!unrestricted && risk.risk === "blocked") {
          status = "blocked";
          output = risk.reason;
          resultContent = `BLOCKED by safety layer: ${risk.reason}`;
        } else if (isTurnCancelled(conversationId)) {
          status = "cancelled";
          output = "Turn cancelled by the human before this action ran.";
          resultContent = `CANCELLED: ${output}`;
        } else {
          const recentCount = await countRecentActions();
          if (recentCount >= settings.maxActionsPerHour) {
            status = "rate_limited";
            output = `Rate limit reached (${settings.maxActionsPerHour}/hour). Try again later or ask the human to raise the limit in Settings.`;
            resultContent = `RATE LIMITED: ${output}`;
          } else {
            const auto = autonomyAllowsAuto(mode, risk.risk);
            if (auto) {
              try {
              const maxRetries = settings.toolRetries ?? 1;
              let attempt = 0;
              let lastError = "";
              while (attempt <= maxRetries) {
                try {
                  const execResult = await executeTool(toolName, args, settings, {
                    conversationId,
                    sessionId: session.id,
                  });
                  status = "success";
                  output = execResult.output;
                  resultContent = output;
                  break;
                } catch (err) {
                  attempt++;
                  lastError = err instanceof Error ? err.message : String(err);
                  if (attempt > maxRetries) {
                    status = "error";
                    output = lastError;
                    resultContent = `ERROR (after ${maxRetries} retries): ${output}`;
                  } else {
                    await new Promise((r) => setTimeout(r, 1000));
                  }
                }
              }
              if (attempt > 0 && status === "success") {
                resultContent = `SUCCESS (retried ${attempt} time(s)): ${output}`;
              }
              } catch (err) {
                status = "error";
                output = err instanceof Error ? err.message : String(err);
                resultContent = `ERROR: ${output}`;
              }
            } else {
              status = "awaiting_approval";
              output = "";
              resultContent = `PENDING HUMAN APPROVAL (execution #${execution.id}, risk=${risk.risk}): ${risk.reason} This has NOT run yet. A human must approve it from the Approvals tab before it executes.`;
            }
          }
        }

        await db
          .update(toolExecutions)
          .set({
            status,
            output: output || null,
            resolvedAt: status === "awaiting_approval" ? null : new Date(),
            resolvedBy: status === "awaiting_approval" ? null : "auto",
          })
          .where(eq(toolExecutions.id, execution.id));

        onEvent?.({ type: "tool_result", tool: toolName, status, executionId: execution.id, output: resultContent });

        const toolMsgRow = await insertMessage({
          conversationId,
          role: "tool",
          content: resultContent,
          toolCallId: call.id,
          toolName,
          toolArgs: args,
        });
        newMessages.push(toolMsgRow);
        apiMessages.push({ role: "tool", tool_call_id: call.id, content: resultContent });
      }
    }

    // If the step limit was reached while the agent was still working (it didn't
    // choose to stop), insert an event so the agent knows it was truncated and the
    // human sees a clear indicator that more work is pending.
    if (ranTools && session.stepsUsed >= maxSteps && !terminated) {
      const truncEvent = await insertMessage({
        conversationId,
        role: "event",
        content: `[TRUNCATED] Work session #${session.id} reached its step limit (${maxSteps} steps) and was stopped mid-task.`,
      });
      newMessages.push(truncEvent);
      apiMessages.push({
        role: "user",
        content:
          "[SYSTEM] Your turn was truncated — you hit the step limit. Briefly summarize what you just achieved and ask the human if they want you to continue the task. Reply in text only — do not call any tools.",
      });
      try {
        const truncCompletion = await client.chat.completions.create(
          modelRequestParams(settings, {
            model: settings.modelName,
            messages: apiMessages,
          }),
        );
        const tMsg = truncCompletion.choices[0].message as OpenAI.Chat.Completions.ChatCompletionMessage & {
          reasoning_content?: string;
        };
        const tUsage = truncCompletion.usage as UsageLike | undefined;
        accumulateUsage(session, tUsage, inputPrice, outputPrice, cacheHitPrice);
        const tCost = usageCost(tUsage, inputPrice, outputPrice, cacheHitPrice);
        const tRow = await insertMessage({
          conversationId,
          role: "assistant",
          content: tMsg.content ?? "",
          reasoning: tMsg.reasoning_content ?? null,
          sessionId: session.id,
          promptTokens: tUsage?.prompt_tokens ?? null,
          completionTokens: tUsage?.completion_tokens ?? null,
          totalTokens: tUsage?.total_tokens ?? null,
          costUsd: tCost ? Number(tCost.toFixed(6)) : null,
        });
        newMessages.push(tRow);
      } catch {
        // best-effort; the truncation event is already in the conversation
      }
    }

    // Always end a working turn with a plain-language summary: if the last
    // assistant message was empty (e.g. it stopped on a tool call alone), make
    // one final no-tools completion asking for a summary.
    if (ranTools && lastContentEmpty && Date.now() < deadline && !isTurnCancelled(conversationId)) {
      try {
        const summaryCompletion = await client.chat.completions.create(
          modelRequestParams(settings, {
            model: settings.modelName,
            messages: [
              ...apiMessages,
              {
                role: "user",
                content:
                  "Give a brief plain-language summary of what you just did in this turn: the actions you took (including any tools) and their outcome. Reply with only the summary.",
              },
            ],
          }),
        );
        const sMsg = summaryCompletion.choices[0].message as OpenAI.Chat.Completions.ChatCompletionMessage & {
          reasoning_content?: string;
        };
        const sUsage = summaryCompletion.usage as UsageLike | undefined;
        accumulateUsage(session, sUsage, inputPrice, outputPrice, cacheHitPrice);
        const sCost = usageCost(sUsage, inputPrice, outputPrice, cacheHitPrice);
        const sRow = await insertMessage({
          conversationId,
          role: "assistant",
          content: sMsg.content ?? "",
          reasoning: sMsg.reasoning_content ?? null,
          sessionId: session.id,
          promptTokens: sUsage?.prompt_tokens ?? null,
          completionTokens: sUsage?.completion_tokens ?? null,
          totalTokens: sUsage?.total_tokens ?? null,
          costUsd: sCost ? Number(sCost.toFixed(6)) : null,
        });
        newMessages.push(sRow);
      } catch {
        // Best-effort; never fail the turn because the summary call failed.
      }
    }

    await finishSession(
      session,
      cancelled || terminated ? "terminated" : "completed",
      cancelled ? "cancelled by human" : terminated ? "time limit reached" : undefined,
    );
    cancelledConversations.delete(conversationId);
  } catch (err) {
    await finishSession(session, "failed", err instanceof Error ? err.message : String(err));
    cancelledConversations.delete(conversationId);
    throw err;
  }

  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

  return { conversationId, newMessages };
}

export async function resolveApproval(executionId: number, decision: "approved" | "denied", note?: string) {
  const rows = await db.select().from(toolExecutions).where(eq(toolExecutions.id, executionId));
  if (!rows.length) throw new Error("Execution not found");
  const execution = rows[0];
  if (execution.status !== "awaiting_approval") {
    throw new Error(`Execution is not awaiting approval (status=${execution.status})`);
  }

  const settings = await getSettings();
  let output = "";
  let status: typeof toolExecutions.$inferInsert.status = decision;
  let heldByPause = false;

  if (decision === "approved") {
    if (settings.paused) {
      heldByPause = true;
      status = "denied";
      output = "Not run: the agent is globally PAUSED. Approvals are held until it is resumed.";
    } else {
      try {
        const result = await executeTool(execution.tool, (execution.input as Record<string, unknown>) || {}, settings, {
          conversationId: execution.conversationId,
        });
        output = result.output;
        status = "approved";
      } catch (err) {
        status = "error";
        output = err instanceof Error ? err.message : String(err);
      }
    }
  } else {
    output = note || "Denied by human operator.";
  }

  await db
    .update(toolExecutions)
    .set({ status, output, resolvedAt: new Date(), resolvedBy: "human" })
    .where(eq(toolExecutions.id, executionId));

  // Rewrite the original tool message so the model's history reflects the real
  // outcome instead of permanently reading "PENDING HUMAN APPROVAL ... has NOT run yet".
  if (execution.messageId) {
    const outcome =
      decision === "approved"
        ? heldByPause
          ? `APPROVED-HELD — the human approved this "${execution.tool}" request but it did NOT run because the agent is paused.\n${output}`
          : `APPROVED — the human approved this "${execution.tool}" request and it ran.\nResult:\n${output}`
        : `DENIED — the human rejected this "${execution.tool}" request.${note ? ` Reason: ${note}` : ""} It did NOT run.`;
    await db.update(messages).set({ content: outcome }).where(eq(messages.id, execution.messageId));
  }

  // If the action was held by the global pause, don't spin up a session just to
  // have every tool call blocked; the approvals UI + rewritten message show why.
  if (heldByPause) return null;

  const eventNote =
    decision === "approved"
      ? `Human approved your "${execution.tool}" request (execution #${execution.id}). Result:\n${output}`
      : `Human DENIED your "${execution.tool}" request (execution #${execution.id}). ${note ? `Reason: ${note}` : ""}`;

  if (execution.conversationId) {
    return runAgentTurn({ conversationId: execution.conversationId, eventNote, trigger: "approval" });
  }
  return null;
}
