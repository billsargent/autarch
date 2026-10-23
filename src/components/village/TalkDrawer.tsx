"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Markdown from "../Markdown";
import { useConversation } from "./useConversation";

interface TalkDrawerProps {
  agentName: string;
  color: string;
  conversations: Array<{ id: number; title: string }>;
  initialConversationId: number | null;
  onClose: () => void;
}

// Side drawer for talking to a villager without leaving the village.
export default function TalkDrawer({ agentName, color, conversations, initialConversationId, onClose }: TalkDrawerProps) {
  const [conversationId, setConversationId] = useState<number | null>(initialConversationId);
  const [input, setInput] = useState("");
  const { messages, sending, status, error, send, stop } = useConversation(conversationId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const visible = messages.filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length, status]);

  async function submit() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const id = await send(text);
    if (id && id !== conversationId) setConversationId(id);
  }

  async function newChat() {
    const created = await fetch("/api/conversations", { method: "POST" }).then((r) => r.json());
    if (created.conversation?.id) setConversationId(created.conversation.id);
  }

  return (
    <aside
      className="village-panel absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l-4 border-[#3b2716] bg-[#f4ead5] text-[#3b2716] shadow-2xl"
      aria-label={`Talk to ${agentName}`}
    >
      <header className="flex items-center gap-3 border-b-4 border-[#3b2716] bg-[#6b4a2e] px-4 py-3 text-[#f4ead5]">
        <span className="h-4 w-4 rounded-sm border-2 border-[#3b2716]" style={{ background: color }} />
        <h2 className="village-pixel flex-1 text-sm">Talking with {agentName}</h2>
        <Link
          href="/village/cottage?open=chat.open"
          className="village-btn px-2 py-1 text-xs"
          title="Every conversation, tool messages, uploads and live activity"
        >
          Full chat
        </Link>
        <button onClick={onClose} className="village-btn px-2 py-1 text-xs" aria-label="Close">
          ✕
        </button>
      </header>

      <div className="flex items-center gap-2 border-b-2 border-[#d8c49a] px-4 py-2 text-xs">
        <select
          value={conversationId ?? ""}
          onChange={(e) => setConversationId(e.target.value ? Number(e.target.value) : null)}
          className="min-w-0 flex-1 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1"
        >
          {conversationId === null && <option value="">New conversation</option>}
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || "New session"}
            </option>
          ))}
        </select>
        <button onClick={newChat} className="village-btn px-2 py-1">
          + New
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {visible.length === 0 && !sending && (
          <p className="mt-8 text-center text-[#6b4a2e]">Say hello to {agentName}.</p>
        )}
        {visible.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-10 rounded-lg border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2">
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="mr-6 rounded-lg border-2 border-[#3b2716] px-3 py-2" style={{ background: `${color}22` }}>
              <p className="village-pixel mb-1 text-[11px]" style={{ color }}>
                {agentName}
              </p>
              <Markdown className="village-md">{m.content ?? ""}</Markdown>
            </div>
          ),
        )}
        {status && <p className="text-xs italic text-[#6b4a2e]">{agentName} is {status}</p>}
        {error && <p className="rounded border-2 border-[#d9643a] bg-[#fbe3d8] px-3 py-2 text-xs">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <footer className="flex gap-2 border-t-4 border-[#3b2716] bg-[#ead9b4] p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder={`Ask ${agentName} something…`}
          className="min-w-0 flex-1 resize-none rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 text-sm outline-none"
        />
        {sending ? (
          <button onClick={stop} className="village-btn village-btn-danger px-3 text-xs">
            Stop
          </button>
        ) : (
          <button onClick={() => void submit()} className="village-btn village-btn-primary px-3 text-xs">
            Send
          </button>
        )}
      </footer>
    </aside>
  );
}
