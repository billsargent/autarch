"use client";

import { memo, useEffect, useRef } from "react";
import type { MessageRow } from "@/lib/agent/clientTypes";
import Markdown from "./Markdown";

function toolCardStyle(content: string | null) {
  const c = content || "";
  if (c.startsWith("BLOCKED")) return "border-rose-700/50 bg-rose-950/30 text-rose-200";
  if (c.startsWith("PENDING HUMAN APPROVAL")) return "border-amber-700/50 bg-amber-950/20 text-amber-200";
  if (c.startsWith("RATE LIMITED")) return "border-orange-700/50 bg-orange-950/20 text-orange-200";
  if (c.startsWith("ERROR")) return "border-red-700/50 bg-red-950/20 text-red-200";
  return "border-neutral-800 bg-neutral-900 text-neutral-300";
}

function toolBadge(content: string | null) {
  const c = content || "";
  if (c.startsWith("BLOCKED")) return { text: "BLOCKED", cls: "bg-rose-800 text-rose-100" };
  if (c.startsWith("PENDING HUMAN APPROVAL")) return { text: "AWAITING APPROVAL", cls: "bg-amber-700 text-amber-50" };
  if (c.startsWith("RATE LIMITED")) return { text: "RATE LIMITED", cls: "bg-orange-700 text-orange-50" };
  if (c.startsWith("ERROR")) return { text: "ERROR", cls: "bg-red-700 text-red-50" };
  return { text: "EXECUTED", cls: "bg-emerald-700 text-emerald-50" };
}

function formatArgs(args: unknown) {
  if (!args || typeof args !== "object") return "";
  const entries = Object.entries(args as Record<string, unknown>);
  if (!entries.length) return "";
  return entries.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
}

const QUICK_ACTIONS = [
  "What have you been working on lately? Summarize from your journal.",
  "Check the system status (CPU, memory, disk, uptime) and tell me how the system is doing.",
  "Explore your sandbox workspace and tell me what's in there.",
  "Pick something interesting to learn about or build, log it in your journal, and get started.",
];

// Compare the fields that affect rendering so identical content (e.g. from a
// poll returning the same message objects) doesn't trigger a re-render.
function sameMessage(a: MessageRow, b: MessageRow) {
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.content === b.content &&
    a.reasoning === b.reasoning &&
    a.toolName === b.toolName &&
    a.toolCallId === b.toolCallId &&
    a.createdAt === b.createdAt &&
    JSON.stringify(a.toolArgs ?? null) === JSON.stringify(b.toolArgs ?? null) &&
    JSON.stringify(a.toolCalls ?? null) === JSON.stringify(b.toolCalls ?? null)
  );
}

function UserBubbleView({ m }: { m: MessageRow }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm text-white break-words">
        {m.content}
      </div>
    </div>
  );
}
const UserBubble = memo(UserBubbleView, (a, b) => sameMessage(a.m, b.m));
UserBubble.displayName = "UserBubble";

function EventBubbleView({ m }: { m: MessageRow }) {
  return (
    <div className="mx-auto rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-[11px] text-neutral-400">
      {m.content}
    </div>
  );
}
const EventBubble = memo(EventBubbleView, (a, b) => sameMessage(a.m, b.m));
EventBubble.displayName = "EventBubble";

function AssistantBubbleView({ m }: { m: MessageRow }) {
  if (!m.content && !m.reasoning) return null;
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] min-w-0 rounded-2xl rounded-bl-sm bg-neutral-900 px-4 py-3 text-sm text-neutral-100">
        {m.reasoning && (
          <details className="mb-2 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
            <summary className="cursor-pointer text-[11px] text-neutral-500">thinking…</summary>
            <Markdown className="mt-1 text-[11px] text-neutral-500">{m.reasoning}</Markdown>
          </details>
        )}
        {m.content && <Markdown>{m.content}</Markdown>}
      </div>
    </div>
  );
}
const AssistantBubble = memo(AssistantBubbleView, (a, b) => sameMessage(a.m, b.m));
AssistantBubble.displayName = "AssistantBubble";

function ToolBubbleView({ m }: { m: MessageRow }) {
  const badge = toolBadge(m.content);
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${toolCardStyle(m.content)}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono font-semibold">🔧 {m.toolName}</span>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${badge.cls}`}>{badge.text}</span>
      </div>
      {formatArgs(m.toolArgs) && (
        <p className="mb-1 font-mono text-[11px] text-neutral-500">{formatArgs(m.toolArgs)}</p>
      )}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug">{m.content}</pre>
    </div>
  );
}
const ToolBubble = memo(ToolBubbleView, (a, b) => sameMessage(a.m, b.m));
ToolBubble.displayName = "ToolBubble";

export interface MessageListProps {
  msgs: MessageRow[];
  sending: boolean;
  error: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onQuickAction: (text: string) => void;
}

function MessageListInner({
  msgs,
  sending,
  error,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onQuickAction,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  const nearBottomRef = useRef(true);
  const scrollAnchorRef = useRef(0);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 60 && hasMore && !loadingOlder) onLoadOlder();
  }

  // Auto-scroll to bottom only when new messages arrived at the bottom AND the
  // user is already near the bottom (never yank them away while scrolling up).
  useEffect(() => {
    const len = msgs.length;
    if (len === prevLenRef.current) return;
    const grew = len > prevLenRef.current;
    prevLenRef.current = len;
    if (grew && !loadingOlder && nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: len > 200 ? "auto" : "smooth" });
    }
  }, [msgs.length, loadingOlder]);

  // Preserve the visible position when older messages are prepended above.
  useEffect(() => {
    if (loadingOlder) {
      scrollAnchorRef.current = containerRef.current?.scrollHeight ?? 0;
    } else if (scrollAnchorRef.current > 0) {
      const el = containerRef.current;
      if (el) el.scrollTop += el.scrollHeight - scrollAnchorRef.current;
      scrollAnchorRef.current = 0;
    }
  }, [loadingOlder]);

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-4">
      {msgs.length === 0 && !sending && (
        <div className="mx-auto mt-10 max-w-lg text-center text-sm text-neutral-500">
          <p className="mb-4">No messages yet. Try one of these:</p>
          <div className="flex flex-col gap-2">
            {QUICK_ACTIONS.map((q) => (
              <button
                key={q}
                onClick={() => onQuickAction(q)}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-left text-xs hover:border-neutral-600"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      {loadingOlder && (
        <p className="py-2 text-center text-[11px] text-neutral-600">loading earlier messages…</p>
      )}
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {msgs.map((m) => {
          switch (m.role) {
            case "user":
              return <UserBubble key={m.id} m={m} />;
            case "event":
              return <EventBubble key={m.id} m={m} />;
            case "assistant":
              return <AssistantBubble key={m.id} m={m} />;
            case "tool":
              return <ToolBubble key={m.id} m={m} />;
            default:
              return null;
          }
        })}
        {sending && <div className="text-xs text-neutral-500">Root is thinking / acting…</div>}
        {error && <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export const MessageList = memo(MessageListInner);
