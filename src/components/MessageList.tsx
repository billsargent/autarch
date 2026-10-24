"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { MessageRow } from "@/lib/agent/clientTypes";
import Markdown from "./Markdown";

// Two looks for the same list: the dark Command Center and the village's
// parchment. Each is a constant, so memoized bubbles can compare it by reference.
type ToolKind = "blocked" | "pending" | "rate" | "cancelled" | "error" | "ok";

export interface ListTheme {
  container: string;
  empty: string;
  quick: string;
  older: string;
  user: string;
  userTime: string;
  event: string;
  eventTime: string;
  assistant: string;
  thinking: string;
  thinkingSummary: string;
  thinkingText: string;
  time: string;
  toolArgs: string;
  working: string;
  error: string;
  tool: Record<ToolKind, { card: string; badge: string }>;
}

export const DARK_THEME: ListTheme = {
  container: "flex-1 overflow-y-auto px-6 py-4",
  empty: "mx-auto mt-10 max-w-lg text-center text-sm text-neutral-500",
  quick: "rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-left text-xs hover:border-neutral-600",
  older: "py-2 text-center text-[11px] text-neutral-600",
  user: "max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm text-white break-words",
  userTime: "mt-1 text-right text-[9px] text-blue-300/60",
  event: "mx-auto rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-[11px] text-neutral-400",
  eventTime: "ml-2 text-[9px] text-neutral-600",
  assistant: "max-w-[85%] min-w-0 rounded-2xl rounded-bl-sm bg-neutral-900 px-4 py-3 text-sm text-neutral-100",
  thinking: "mb-2 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2",
  thinkingSummary: "cursor-pointer text-[11px] text-neutral-500",
  thinkingText: "mt-1 text-[11px] text-neutral-500",
  time: "mt-2 text-right text-[9px] text-neutral-600",
  toolArgs: "mb-1 font-mono text-[11px] text-neutral-500",
  working: "text-xs text-neutral-500",
  error: "rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300",
  tool: {
    blocked: { card: "border border-rose-700/50 bg-rose-950/30 text-rose-200", badge: "bg-rose-800 text-rose-100" },
    pending: { card: "border border-amber-700/50 bg-amber-950/20 text-amber-200", badge: "bg-amber-700 text-amber-50" },
    rate: { card: "border border-orange-700/50 bg-orange-950/20 text-orange-200", badge: "bg-orange-700 text-orange-50" },
    cancelled: { card: "border border-neutral-700 bg-neutral-900 text-neutral-400", badge: "bg-neutral-700 text-neutral-300" },
    error: { card: "border border-red-700/50 bg-red-950/20 text-red-200", badge: "bg-red-700 text-red-50" },
    ok: { card: "border border-neutral-800 bg-neutral-900 text-neutral-300", badge: "bg-emerald-700 text-emerald-50" },
  },
};

export const VILLAGE_THEME: ListTheme = {
  container: "flex-1 overflow-y-auto px-3 py-3 sm:px-4",
  empty: "mx-auto mt-6 max-w-lg text-center text-sm text-[#6b4a2e]",
  quick: "rounded border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2 text-left text-xs text-[#3b2716] hover:bg-white",
  older: "py-2 text-center text-[11px] text-[#6b4a2e]",
  user: "max-w-[85%] rounded-lg border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2 text-sm text-[#3b2716] break-words",
  userTime: "mt-1 text-right text-[9px] text-[#8a6a48]",
  event: "mx-auto max-w-full break-words rounded-lg border-2 border-[#d8c49a] bg-[#ead9b4] px-3 py-1 text-[11px] text-[#5a3d25]",
  eventTime: "ml-2 text-[9px] text-[#8a6a48]",
  assistant: "village-md max-w-[90%] min-w-0 rounded-lg border-2 border-[#3b2716] bg-[#e7efd9] px-3 py-2 text-sm text-[#2b2116]",
  thinking: "mb-2 rounded border-2 border-dashed border-[#c9b27a] bg-[#fffaf0]/70 px-3 py-2",
  thinkingSummary: "cursor-pointer text-[11px] text-[#6b4a2e]",
  thinkingText: "mt-1 text-[11px] text-[#6b4a2e]",
  time: "mt-1.5 text-right text-[9px] text-[#8a6a48]",
  toolArgs: "mb-1 font-mono text-[11px] opacity-75",
  working: "text-xs italic text-[#6b4a2e]",
  error: "rounded border-2 border-[#b3261e] bg-[#fbe3df] px-3 py-2 text-xs text-[#7a1a14]",
  tool: {
    blocked: { card: "border-2 border-[#7a1712] bg-[#f6dcd8] text-[#4a0f0b]", badge: "bg-[#7a1712] text-white" },
    pending: { card: "border-2 border-[#c58a1b] bg-[#fbecc8] text-[#4d3405]", badge: "bg-[#c58a1b] text-white" },
    rate: { card: "border-2 border-[#d9643a] bg-[#fbe3d8] text-[#5a2410]", badge: "bg-[#d9643a] text-white" },
    cancelled: { card: "border-2 border-[#8a6a48] bg-[#efe6d2] text-[#5a3d25]", badge: "bg-[#8a6a48] text-white" },
    error: { card: "border-2 border-[#b3261e] bg-[#fbe3df] text-[#5a120d]", badge: "bg-[#b3261e] text-white" },
    ok: { card: "border-2 border-[#3b2716] bg-[#fffaf0] text-[#3b2716]", badge: "bg-[#5f8a3c] text-white" },
  },
};

function toolKind(content: string | null): ToolKind {
  const c = content || "";
  if (c.startsWith("BLOCKED")) return "blocked";
  if (c.startsWith("PENDING HUMAN APPROVAL")) return "pending";
  if (c.startsWith("RATE LIMITED")) return "rate";
  if (c.startsWith("CANCELLED")) return "cancelled";
  if (c.startsWith("ERROR")) return "error";
  return "ok";
}

const TOOL_BADGE: Record<ToolKind, string> = {
  blocked: "BLOCKED",
  pending: "AWAITING APPROVAL",
  rate: "RATE LIMITED",
  cancelled: "CANCELLED",
  error: "ERROR",
  ok: "EXECUTED",
};

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

function fmtTime(iso: string | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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

interface BubbleProps {
  m: MessageRow;
  t: ListTheme;
}
const sameBubble = (a: BubbleProps, b: BubbleProps) => a.t === b.t && sameMessage(a.m, b.m);

function UserBubbleView({ m, t }: BubbleProps) {
  return (
    <div className="flex justify-end">
      <div className={t.user}>
        {m.content}
        {m.createdAt && <div className={t.userTime}>{fmtTime(m.createdAt)}</div>}
      </div>
    </div>
  );
}
const UserBubble = memo(UserBubbleView, sameBubble);
UserBubble.displayName = "UserBubble";

function EventBubbleView({ m, t }: BubbleProps) {
  // A long or multi-line event reads as a block, not a squeezed pill (#39).
  const long = (m.content ?? "").length > 120 || (m.content ?? "").includes("\n");
  return (
    <div className={long ? `${t.event} !block !max-h-60 !overflow-auto !rounded-md !text-left !whitespace-pre-wrap` : t.event}>
      {m.content}
      {m.createdAt && <span className={t.eventTime}>{fmtTime(m.createdAt)}</span>}
    </div>
  );
}
const EventBubble = memo(EventBubbleView, sameBubble);
EventBubble.displayName = "EventBubble";

function AssistantBubbleView({ m, t }: BubbleProps) {
  if (!m.content && !m.reasoning) return null;
  return (
    <div className="flex justify-start">
      <div className={t.assistant}>
        {m.reasoning && (
          <details className={t.thinking}>
            <summary className={t.thinkingSummary}>thinking…</summary>
            <Markdown className={t.thinkingText}>{m.reasoning}</Markdown>
          </details>
        )}
        {m.content && <Markdown>{m.content}</Markdown>}
        {m.createdAt && <div className={t.time}>{fmtTime(m.createdAt)}</div>}
      </div>
    </div>
  );
}
const AssistantBubble = memo(AssistantBubbleView, sameBubble);
AssistantBubble.displayName = "AssistantBubble";

function ToolBubbleView({ m, t }: BubbleProps) {
  const kind = toolKind(m.content);
  return (
    <div className={`rounded-xl px-3 py-2 text-xs ${t.tool[kind].card}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono font-semibold">🔧 {m.toolName}</span>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${t.tool[kind].badge}`}>{TOOL_BADGE[kind]}</span>
      </div>
      {formatArgs(m.toolArgs) && <p className={t.toolArgs}>{formatArgs(m.toolArgs)}</p>}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug">{m.content}</pre>
      {kind === "pending" && <InlineApproval content={m.content ?? ""} />}
      {m.createdAt && <div className={t.time}>{fmtTime(m.createdAt)}</div>}
    </div>
  );
}

// Approve or deny a waiting request right from the chat (#38). The message
// itself is rewritten with the outcome on the next refresh.
function InlineApproval({ content }: { content: string }) {
  const id = Number(/execution #(\d+)/.exec(content)?.[1]);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "approved" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!id) return null;
  async function decide(decision: "approved" | "denied") {
    setState("busy");
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setState("idle");
      } else setState(decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }
  if (state === "approved" || state === "denied") return <p className="mt-1 font-semibold">{state === "approved" ? "✅ Approved: it's running." : "❌ Denied."}</p>;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note"
        aria-label="Note for the agent"
        className="min-w-0 flex-1 rounded border border-current/40 bg-transparent px-1.5 py-0.5 text-[11px]"
      />
      <button disabled={state === "busy"} onClick={() => void decide("approved")} className="rounded bg-[#5f8a3c] px-2 py-0.5 text-[11px] font-semibold text-white">
        Approve
      </button>
      <button disabled={state === "busy"} onClick={() => void decide("denied")} className="rounded bg-[#b3261e] px-2 py-0.5 text-[11px] font-semibold text-white">
        Deny
      </button>
      {error && <span className="w-full text-[11px]">{error}</span>}
    </div>
  );
}
const ToolBubble = memo(ToolBubbleView, sameBubble);
ToolBubble.displayName = "ToolBubble";

export interface MessageListProps {
  msgs: MessageRow[];
  sending: boolean;
  error: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onQuickAction: (text: string) => void;
  agentName: string;
  theme?: ListTheme;
}

function MessageListInner({
  msgs,
  sending,
  error,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onQuickAction,
  agentName,
  theme: t = DARK_THEME,
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
    <div ref={containerRef} onScroll={handleScroll} className={t.container}>
      {msgs.length === 0 && !sending && (
        <div className={t.empty}>
          <p className="mb-4">No messages yet. Try one of these:</p>
          <div className="flex flex-col gap-2">
            {QUICK_ACTIONS.map((q) => (
              <button key={q} onClick={() => onQuickAction(q)} className={t.quick}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      {loadingOlder && <p className={t.older}>loading earlier messages…</p>}
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {msgs.map((m) => {
          switch (m.role) {
            case "user":
              return <UserBubble key={m.id} m={m} t={t} />;
            case "event":
              return <EventBubble key={m.id} m={m} t={t} />;
            case "assistant":
              return <AssistantBubble key={m.id} m={m} t={t} />;
            case "tool":
              return <ToolBubble key={m.id} m={m} t={t} />;
            default:
              return null;
          }
        })}
        {sending && <div className={t.working}>{agentName} is thinking / acting…</div>}
        {error && <div className={t.error}>{error}</div>}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export const MessageList = memo(MessageListInner);
