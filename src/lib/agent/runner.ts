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
import { isChatMode, resolveToolAccess } from "./chatMode";
import { HEARTBEAT_MS, TurnBusyError, claimTurn, heartbeat, isCancelRequested } from "./turnLock";
import { BudgetError, actionsInLastHour, agentModel, budgetProblem, effectiveTools, getAgent, listVillagers, type AgentRow } from "./agents";

export { BudgetError } from "./agents";

export { TurnBusyError } from "./turnLock";

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
  signal?: AbortSignal,
): Promise<StreamedMessage> {
  let stream;
  try {
    stream = await client.chat.completions.create(
      {
        ...modelRequestParams(settings, base),
        stream: true,
        stream_options: { include_usage: true },
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & DeepSeekThinking,
      { signal },
    );
  } catch (err) {
    // Stopped before the first chunk arrived.
    if (signal?.aborted) return { content: "", reasoningContent: "", toolCalls: null, usage: undefined, interrupted: true };
    throw err;
  }

  let content = "";
  let reasoning = "";
  let usage: UsageLike | undefined;
  const toolAcc: Array<{ id?: string; type?: string; function: { name: string; arguments: string } }> = [];
  let interrupted = false;

  try {
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
  } catch (err) {
    if (!signal?.aborted) throw err;
  }
  // An abort can also just end the stream quietly; either way the reply was
  // cut off, not finished.
  if (signal?.aborted) interrupted = true;

  // Deltas don't always carry the call's type or id (and indices can skip);
  // a call without them would be dropped here and break the next request.
  const calls = toolAcc.filter(Boolean).map((t, i) => ({
    id: t.id || `call_${Date.now().toString(36)}_${i}`,
    type: "function" as const,
    function: t.function,
  }));
  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null = calls.length ? calls : null;

  return { content, reasoningContent: reasoning, toolCalls, usage, interrupted };
}

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3, blocked: 4 };

function worseRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

// Tools that only read, so retrying one after a failure can't repeat a side
// effect (#21). Everything else runs once.
const RETRYABLE_TOOLS = new Set([
  "read_file",
  "list_directory",
  "get_system_status",
  "list_processes",
  "fetch_url",
  "list_jobs",
  "list_goals",
  "query_database",
  "web_search",
]);

// Time box for the closing calls (truncation reply, summary) (#21).
const CLOSING_CALL_TIMEOUT_MS = 120_000;

export async function ensureConversation(conversationId?: number | null, agentId?: number | null) {
  if (conversationId) {
    const rows = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (rows.length) return rows[0];
  }
  // New conversations start in the global default chat mode; after that each
  // conversation keeps its own. They belong to the villager being talked to
  // (the Mayor if none is named).
  const { chatMode } = await getSettings();
  const agent = await getAgent(agentId);
  const inserted = await db
    .insert(conversations)
    .values({ title: "New session", chatMode: isChatMode(chatMode) ? chatMode : "agentic", agentId: agent.id })
    .returning();
  return inserted[0];
}

// The town settings as one villager sees them: its own model, and its own
// tools within the town's tool policy.
function settingsFor(agent: AgentRow, town: AgentSettingsRow): AgentSettingsRow {
  return { ...town, modelName: agentModel(agent, town), enabledTools: effectiveTools(agent, town) };
}

async function insertMessage(row: typeof messages.$inferInsert) {
  const inserted = await db.insert(messages).values(row).returning();
  return inserted[0];
}

async function loadHistory(conversationId: number) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.id));
}

export type SessionTrigger = "chat" | "approval" | "scheduled" | "report" | "message";

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

// Claims the conversation for this turn (throws TurnBusyError if another turn
// holds it) and starts its work session.
function beginSession(
  trigger: SessionTrigger,
  opts: { jobId?: number | null; conversationId: number; agentId: number; maxDurationMinutes?: number },
): ActiveSession {
  const row = claimTurn({ conversationId: opts.conversationId, trigger, jobId: opts.jobId, agentId: opts.agentId });
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
  // For a new conversation: which villager it's with (default: the Mayor).
  agentId?: number | null;
}, onEvent?: (e: AgentEvent) => void): Promise<AgentTurnResult> {
  const conversation = await ensureConversation(opts.conversationId ?? undefined, opts.agentId);
  const conversationId = conversation.id;
  const newMessages: Array<typeof messages.$inferSelect> = [];

  // The turn runs as the conversation's villager (#56).
  const agent = await getAgent(conversation.agentId);
  if (agent.status === "dismissed") throw new Error(`${agent.name} has left the village, so they can't take part any more.`);
  const settings = settingsFor(agent, await getSettings());
  const villagerPaused = agent.status === "paused";
  // Over today's budget (the villager's or the town's): refuse before
  // anything is written (#60).
  const overBudget = budgetProblem(agent, settings);
  if (overBudget) throw new BudgetError(overBudget);
  const overrides = buildOverrides(settings);
  const trigger: SessionTrigger = opts.trigger ?? (opts.jobId ? "scheduled" : "chat");
  const maxDurationMinutes = opts.maxDurationMinutes ?? settings.maxSessionMinutes;
  // Claim the conversation before writing anything, so a refused turn leaves
  // no trace and two turns never interleave (#18).
  const session = beginSession(trigger, {
    jobId: opts.jobId ?? null,
    conversationId,
    agentId: agent.id,
    maxDurationMinutes,
  });

  // While the turn runs: a heartbeat shows its process is alive, and Stop
  // (cancel_requested, set by any process) aborts whatever is in flight.
  const stop = new AbortController();
  let beats = 0;
  const watch = setInterval(() => {
    try {
      if (isCancelRequested(session.id)) stop.abort();
      if (++beats % Math.round(HEARTBEAT_MS / 1000) === 0) heartbeat(session.id);
    } catch {
      /* the next tick tries again */
    }
  }, 1000);
  const cancelRequested = () => stop.signal.aborted || isCancelRequested(session.id);

  const inputPrice = Number(settings.inputPricePerMTok) || 0.14;
  const outputPrice = Number(settings.outputPricePerMTok) || 0.28;
  const cacheHitPrice = Number(settings.cacheHitInputPricePerMTok) || 0.0028;
  const deadline = session.startedAt.getTime() + session.maxDurationMs;

  try {
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

    const client = getDeepSeekClient({ apiKey: settings.apiKey, baseUrl: settings.apiBaseUrl });
    // Chat turns use the user's fixed maxAgentSteps setting. Work windows (scheduled
    // or report) auto-scale steps from the time budget so a 45min job isn't choked
    // by a 16-step default. Roughly 2 steps per minute (one step ≈ 30s model call + tool).
    const isWorkWindow = trigger === "scheduled" || trigger === "report";
    const maxSteps = isWorkWindow
      ? Math.max(settings.maxAgentSteps, Math.ceil(maxDurationMinutes * 2))
      : Math.max(1, settings.maxAgentSteps);
    const tools = getEnabledToolDefinitions(settings.enabledTools as string[]);
    // Direct user chat in a conversation-mode conversation: we DON'T expose
    // tools at all (a tool call becomes impossible), and toolsForbidden refuses
    // any call that still reaches execution. Each conversation's own toggle is
    // the single explicit control. Scheduled, approval, and self-directed turns
    // always keep tools.
    const isDirectChat = Boolean(opts.userMessage) && !opts.jobId && !opts.trigger;
    const { toolsAvailable, toolsForbidden } = resolveToolAccess({
      isDirectChat,
      chatMode: conversation.chatMode,
      toolCount: tools.length,
    });
    const systemPrompt = await buildSystemPrompt(settings, {
      trigger,
      jobId: opts.jobId ?? null,
      conversationId,
      maxDurationMinutes,
      maxSteps,
      toolsAvailable,
      agent,
      neighbours: (await listVillagers()).filter((v) => v.id !== agent.id),
    });

    const historyRows = await loadHistory(conversationId);
    const built = await buildPromptMessages({ conversationId, rows: historyRows, settings, client, signal: stop.signal });
    const apiMessages: ChatMessageParam[] = [{ role: "system", content: systemPrompt }, ...built];
    onEvent?.({
      type: "session_start",
      sessionId: session.id,
      toolsAvailable,
      model: settings.modelName,
      chatMode: conversation.chatMode,
      toolsCount: tools.length,
    });
    if (process.env.DEBUG) {
      console.log(
        `[turn] trigger=${opts.trigger ?? (opts.jobId ? "scheduled" : "chat")} chatMode=${conversation.chatMode} model=${settings.modelName} tools=${tools.length} available=${toolsAvailable} forbidden=${toolsForbidden}`,
      );
    }
    let terminated = false;
    let cancelled = false;
    let budgetStopped = false;
    let ranTools = false;
    let lastStepHadTools = false;
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

      if (cancelRequested()) {
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

      // A turn that has spent the day's budget stops here (#60).
      const spentOut = step > 0 ? budgetProblem(agent, settings) : null;
      if (spentOut) {
        terminated = true;
        budgetStopped = true;
        const row = await insertMessage({ conversationId, role: "event", content: `[BUDGET] ${spentOut} This turn stopped here.` });
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
        () => stop.signal.aborted || Date.now() > deadline,
        (content, reasoning) => {
          // Live "thinking / generating" indicator in the UI while the model streams.
          onEvent?.({ type: "model_stream", step: step + 1, content, reasoning });
        },
        stop.signal,
      );

      // Cancelled / timed out mid-generation: abort the stream (done above) and
      // stop the turn instead of paying for the rest of the generation.
      if (streamed.interrupted) {
        if (cancelRequested()) {
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
      // Spending so far, written as it happens, so budgets (and the village)
      // see a turn's cost while it runs.
      await db
        .update(workSessions)
        .set({
          stepsUsed: session.stepsUsed,
          promptTokens: session.promptTokens,
          completionTokens: session.completionTokens,
          totalTokens: session.totalTokens,
          costUsd: Number(session.costUsd.toFixed(6)),
        })
        .where(eq(workSessions.id, session.id));

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

      lastStepHadTools = Boolean(rawMsg.tool_calls?.length);
      ranTools = ranTools || lastStepHadTools;
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
            agentId: agent.id,
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
        } else if (villagerPaused) {
          status = "blocked";
          output = `The human has paused ${agent.name}. No actions run while you're paused; you can still chat.`;
          resultContent = `PAUSED: ${output}`;
        } else if (!unrestricted && !toolIsEnabled) {
          status = "blocked";
          output = `This tool ("${toolName}") is currently disabled in the agent's settings.`;
          resultContent = `BLOCKED: ${output}`;
        } else if (!unrestricted && risk.risk === "blocked") {
          status = "blocked";
          output = risk.reason;
          resultContent = `BLOCKED by safety layer: ${risk.reason}`;
        } else if (cancelRequested()) {
          status = "cancelled";
          output = "Turn cancelled by the human before this action ran.";
          resultContent = `CANCELLED: ${output}`;
        } else {
          // The town's hourly cap, and the villager's own (#60).
          const townLimitHit = actionsInLastHour(undefined, execution.id) >= settings.maxActionsPerHour;
          const ownLimitHit = agent.maxActionsPerHour != null && actionsInLastHour(agent.id, execution.id) >= agent.maxActionsPerHour;
          if (townLimitHit || ownLimitHit) {
            status = "rate_limited";
            output = ownLimitHit
              ? `${agent.name}'s limit is reached (${agent.maxActionsPerHour} actions/hour). Try again later or ask the human to raise it.`
              : `The village's rate limit is reached (${settings.maxActionsPerHour}/hour). Try again later or ask the human to raise the limit in Settings.`;
            resultContent = `RATE LIMITED: ${output}`;
          } else {
            const auto = autonomyAllowsAuto(mode, risk.risk);
            if (auto) {
              try {
              const maxRetries = RETRYABLE_TOOLS.has(toolName) ? (settings.toolRetries ?? 1) : 0;
              let attempt = 0;
              let lastError = "";
              while (attempt <= maxRetries) {
                try {
                  const execResult = await executeTool(toolName, args, settings, {
                    conversationId,
                    sessionId: session.id,
                    agentId: agent.id,
                    agentName: agent.name,
                    trigger,
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
                    resultContent = maxRetries > 0 ? `ERROR (after ${maxRetries} retries): ${output}` : `ERROR: ${output}`;
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
        // Point the execution at its tool message, so resolving an approval
        // later rewrites that message (not the assistant's text).
        await db.update(toolExecutions).set({ messageId: toolMsgRow.id }).where(eq(toolExecutions.id, execution.id));
      }
    }

    // If the step limit was reached while the agent was still working (it didn't
    // choose to stop), insert an event so the agent knows it was truncated and the
    // human sees a clear indicator that more work is pending.
    if (lastStepHadTools && session.stepsUsed >= maxSteps && !terminated) {
      const truncEvent = await insertMessage({
        conversationId,
        role: "event",
        content: `[TRUNCATED] Work session #${session.id} reached its step limit (${maxSteps} steps) and was stopped mid-task.`,
      });
      newMessages.push(truncEvent);
      const defaultTrunc = isWorkWindow
        ? "[SYSTEM] Your turn was truncated — you hit the step limit. Briefly note what you accomplished and what remains. The session will resume on the next scheduled run. Reply in text only — do not call any tools."
        : "[SYSTEM] Your turn was truncated — you hit the step limit. Briefly summarize what you just achieved and ask the human if they want you to continue the task. Reply in text only — do not call any tools.";
      const truncMsg = settings.truncationMessage || defaultTrunc;
      apiMessages.push({ role: "user", content: truncMsg });
      try {
        const truncCompletion = await client.chat.completions.create(
          modelRequestParams(settings, {
            model: settings.modelName,
            messages: apiMessages,
          }),
          { timeout: CLOSING_CALL_TIMEOUT_MS, signal: stop.signal },
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
        // That reply is the turn's closing message; don't ask for a second one.
        lastContentEmpty = !(tMsg.content && tMsg.content.trim().length > 0);
      } catch {
        // best-effort; the truncation event is already in the conversation
      }
    }

    // Always end a working turn with a plain-language summary: if the last
    // assistant message was empty (e.g. it stopped on a tool call alone), make
    // one final no-tools completion asking for a summary.
    if (ranTools && lastContentEmpty && Date.now() < deadline && !cancelRequested()) {
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
          { timeout: CLOSING_CALL_TIMEOUT_MS, signal: stop.signal },
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
      cancelled ? "cancelled by human" : budgetStopped ? "budget reached" : terminated ? "time limit reached" : undefined,
    );
  } catch (err) {
    await finishSession(session, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    clearInterval(watch);
  }

  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

  return { conversationId, newMessages };
}

// An approval that can't be resolved; `status` is the HTTP status to report.
export class ApprovalError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// The tool message that recorded "PENDING HUMAN APPROVAL" for an execution.
// New executions point at it directly; older ones pointed at the assistant
// message, so fall back to finding it by the execution number it mentions.
async function pendingToolMessageId(execution: typeof toolExecutions.$inferSelect): Promise<number | null> {
  if (execution.messageId) {
    const rows = await db.select({ id: messages.id, role: messages.role }).from(messages).where(eq(messages.id, execution.messageId));
    if (rows[0]?.role === "tool") return rows[0].id;
  }
  if (!execution.conversationId) return null;
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, execution.conversationId),
        eq(messages.role, "tool"),
        dsql`${messages.content} like ${`PENDING HUMAN APPROVAL (execution #${execution.id},%`}`,
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

// Resolve a pending approval. The decision is saved (and an approved action
// run) before this returns; the agent's follow-up turn then runs in the
// background, so a failing follow-up never makes a saved decision look failed.
export async function resolveApproval(executionId: number, decision: "approved" | "denied", note?: string) {
  const rows = await db.select().from(toolExecutions).where(eq(toolExecutions.id, executionId));
  if (!rows.length) throw new ApprovalError("Execution not found", 404);
  const execution = rows[0];
  if (execution.status !== "awaiting_approval") {
    throw new ApprovalError(`This request was already decided (status=${execution.status}).`, 409);
  }

  const settings = await getSettings();
  // While paused nothing runs, so an approval would be meaningless: refuse and
  // leave the request waiting instead of quietly turning it into a denial.
  if (decision === "approved" && settings.paused) {
    throw new ApprovalError("The agent is paused. Resume it, then approve — this request is still waiting.", 409);
  }

  // Claim the request atomically so two clicks (or two tabs) can't both run it.
  const claimed = await db
    .update(toolExecutions)
    .set({ status: decision, resolvedAt: new Date(), resolvedBy: "human" })
    .where(and(eq(toolExecutions.id, executionId), eq(toolExecutions.status, "awaiting_approval")))
    .returning({ id: toolExecutions.id });
  if (!claimed.length) throw new ApprovalError("This request was already decided.", 409);

  let output = "";
  let status: typeof toolExecutions.$inferInsert.status = decision;
  if (decision === "approved") {
    try {
      const agent = await getAgent(execution.agentId);
      const result = await executeTool(execution.tool, (execution.input as Record<string, unknown>) || {}, settingsFor(agent, settings), {
        conversationId: execution.conversationId,
        agentId: agent.id,
        agentName: agent.name,
      });
      output = result.output;
    } catch (err) {
      status = "error";
      output = err instanceof Error ? err.message : String(err);
    }
  } else {
    output = note || "Denied by human operator.";
  }
  await db.update(toolExecutions).set({ status, output }).where(eq(toolExecutions.id, executionId));

  // Rewrite the tool message so the model's history reflects the real outcome
  // instead of permanently reading "PENDING HUMAN APPROVAL ... has NOT run yet".
  const toolMessageId = await pendingToolMessageId(execution);
  if (toolMessageId) {
    const outcome =
      decision === "approved"
        ? status === "error"
          ? `APPROVED — the human approved this "${execution.tool}" request, but it failed.\nError:\n${output}`
          : `APPROVED — the human approved this "${execution.tool}" request and it ran.\nResult:\n${output}`
        : `DENIED — the human rejected this "${execution.tool}" request.${note ? ` Reason: ${note}` : ""} It did NOT run.`;
    await db.update(messages).set({ content: outcome }).where(eq(messages.id, toolMessageId));
  }

  const conversationId = execution.conversationId;
  if (conversationId) {
    const eventNote =
      decision === "approved"
        ? `Human approved your "${execution.tool}" request (execution #${execution.id}). Result:\n${output}`
        : `Human DENIED your "${execution.tool}" request (execution #${execution.id}). ${note ? `Reason: ${note}` : ""}`;
    void runWhenFree({ conversationId, eventNote, trigger: "approval" }).catch(async (err) => {
      await insertMessage({
        conversationId,
        role: "event",
        content: `[FOLLOW-UP FAILED] Your decision on execution #${execution.id} was saved, but the agent's follow-up turn failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }).catch(() => {});
    });
  }
  return { executionId, status, output };
}

// Run a turn as soon as the conversation is free: an approval follow-up that
// arrives while another turn is running waits its turn instead of
// interleaving with it (#18). Gives up after `maxWaitMs`.
export async function runWhenFree(
  opts: Parameters<typeof runAgentTurn>[0],
  waitMs = 3000,
  maxWaitMs = 60 * 60_000,
): Promise<AgentTurnResult> {
  const until = Date.now() + maxWaitMs;
  for (;;) {
    try {
      return await runAgentTurn(opts);
    } catch (err) {
      if (!(err instanceof TurnBusyError) || Date.now() > until) throw err;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
