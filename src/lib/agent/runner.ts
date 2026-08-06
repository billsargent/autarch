import { db } from "@/db";
import { conversations, messages, toolExecutions, workSessions } from "@/db/schema";
import { eq, asc, and, gte, inArray, sql as dsql } from "drizzle-orm";
import type OpenAI from "openai";
import { historyToApiMessages } from "./messageHistory";
import { getDeepSeekClient } from "./deepseekClient";
import { getSettings, type AgentSettingsRow } from "./settingsStore";
import { buildSystemPrompt } from "./systemPrompt";
import { getEnabledToolDefinitions, evaluateToolRisk, extraProcessGuard, executeTool } from "./tools";
import { autonomyAllowsAuto, buildOverrides, type RiskLevel } from "./risk";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3, blocked: 4 };

function worseRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
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
    totalTokens: 0,
    costUsd: 0,
  };
}

type UsageLike = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

function usageCost(usage: UsageLike | undefined, inputPrice: number, outputPrice: number): number {
  if (!usage) return 0;
  const p = usage.prompt_tokens ?? 0;
  const c = usage.completion_tokens ?? 0;
  return (p / 1_000_000) * inputPrice + (c / 1_000_000) * outputPrice;
}

function accumulateUsage(session: ActiveSession, usage: UsageLike | undefined, inputPrice: number, outputPrice: number) {
  if (!usage) return;
  const p = usage.prompt_tokens ?? 0;
  const c = usage.completion_tokens ?? 0;
  session.promptTokens += p;
  session.completionTokens += c;
  session.totalTokens += usage.total_tokens ?? p + c;
  session.costUsd += usageCost(usage, inputPrice, outputPrice);
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

  const inputPrice = Number(settings.inputPricePerMTok) || 0.27;
  const outputPrice = Number(settings.outputPricePerMTok) || 1.1;
  const deadline = session.startedAt.getTime() + session.maxDurationMs;

  onEvent?.({ type: "session_start", sessionId: session.id });

  try {
    const client = getDeepSeekClient({ apiKey: settings.apiKey, baseUrl: settings.apiBaseUrl });
    const systemPrompt = await buildSystemPrompt(settings);
    const tools = getEnabledToolDefinitions(settings.enabledTools as string[]);

    const historyRows = await loadHistory(conversationId);
    const apiMessages: ChatMessageParam[] = [{ role: "system", content: systemPrompt }, ...historyToApiMessages(historyRows)];

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

      onEvent?.({ type: "step_start", step: step + 1, maxSteps });

      const completion = await client.chat.completions.create({
        model: settings.modelName,
        messages: apiMessages,
        tools: toolsAvailable ? tools : undefined,
        tool_choice: toolsAvailable ? "auto" : undefined,
      });

      const choice = completion.choices[0];
      const rawMsg = choice.message as OpenAI.Chat.Completions.ChatCompletionMessage & {
        reasoning_content?: string;
      };
      const usage = completion.usage as UsageLike | undefined;
      accumulateUsage(session, usage, inputPrice, outputPrice);
      const callCost = usageCost(usage, inputPrice, outputPrice);
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
        ...(rawMsg.tool_calls?.length ? { tool_calls: rawMsg.tool_calls } : {}),
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
        const truncCompletion = await client.chat.completions.create({
          model: settings.modelName,
          messages: apiMessages,
        });
        const tMsg = truncCompletion.choices[0].message as OpenAI.Chat.Completions.ChatCompletionMessage & {
          reasoning_content?: string;
        };
        const tUsage = truncCompletion.usage as UsageLike | undefined;
        accumulateUsage(session, tUsage, inputPrice, outputPrice);
        const tCost = usageCost(tUsage, inputPrice, outputPrice);
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
    if (ranTools && lastContentEmpty && Date.now() < deadline) {
      try {
        const summaryCompletion = await client.chat.completions.create({
          model: settings.modelName,
          messages: [
            ...apiMessages,
            {
              role: "user",
              content:
                "Give a brief plain-language summary of what you just did in this turn: the actions you took (including any tools) and their outcome. Reply with only the summary.",
            },
          ],
        });
        const sMsg = summaryCompletion.choices[0].message as OpenAI.Chat.Completions.ChatCompletionMessage & {
          reasoning_content?: string;
        };
        const sUsage = summaryCompletion.usage as UsageLike | undefined;
        accumulateUsage(session, sUsage, inputPrice, outputPrice);
        const sCost = usageCost(sUsage, inputPrice, outputPrice);
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

    await finishSession(session, terminated ? "terminated" : "completed", terminated ? "time limit reached" : undefined);
  } catch (err) {
    await finishSession(session, "failed", err instanceof Error ? err.message : String(err));
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
