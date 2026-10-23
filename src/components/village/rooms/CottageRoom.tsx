"use client";

import { useRef, useState } from "react";
import type { JournalEntryRow } from "@/lib/agent/clientTypes";
import { useChat } from "../../data/useChat";
import { JOURNAL_ICON, useJournal } from "../../data/useJournal";
import { MessageList, VILLAGE_THEME } from "../../MessageList";
import ParchmentDialog, { ConfirmDialog } from "../ParchmentDialog";
import type { RoomProps } from "./types";

// The cottage: the armchair by the hearth is the full chat (every
// conversation, its mode, uploads, tool messages, live activity, stop) and
// the diary on the desk is the journal. Same data and actions as the Chat and
// Journal pages (useChat, useJournal).

export default function CottageRoom({ action, onClose }: RoomProps) {
  return action === "journal.open" ? <Diary onClose={onClose} /> : <Parlour onClose={onClose} />;
}

// --- the armchair: talking ------------------------------------------------------

function Parlour({ onClose }: { onClose: () => void }) {
  const chat = useChat();
  const { conversations, activeId, runningByConvo, unreadByConvo, chatMode, agentName } = chat;
  const active = conversations.find((c) => c.id === activeId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text || chat.busy) return;
    chat.send(text);
    setDraft("");
  }

  if (confirmDelete && active) {
    return (
      <ConfirmDialog
        title="Forget this conversation?"
        message={
          <>
            Delete <strong>{active.title || "New session"}</strong>{" "}and all its messages? This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete conversation"
        onConfirm={() => {
          setConfirmDelete(false);
          void chat.deleteConversation(active.id);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    );
  }

  const label = (c: (typeof conversations)[number]) =>
    `${runningByConvo[c.id] ? "● " : ""}${c.chatMode === "conversation" ? "💬 " : ""}${c.title || "New session"}${
      unreadByConvo[c.id] ? ` (${unreadByConvo[c.id]} new)` : ""
    }`;

  return (
    <ParchmentDialog kicker="The armchair by the hearth" title={`Talking with ${agentName}`} onClose={onClose} tall>
      <div className="flex min-h-0 flex-1">
        {/* Conversation list: a column on wider screens, a picker on phones. */}
        <nav aria-label="Conversations" className="hidden w-52 shrink-0 flex-col border-r-2 border-[#d8c49a] bg-[#ead9b4]/60 sm:flex">
          <button onClick={() => void chat.newConversation()} className="village-btn village-btn-primary m-2 px-2 py-1.5 text-xs">
            + New conversation
          </button>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => chat.setActiveId(c.id)}
                  aria-current={c.id === activeId ? "true" : undefined}
                  className={`flex w-full items-center gap-1.5 rounded border-2 px-2 py-1.5 text-left text-xs ${
                    c.id === activeId ? "border-[#3b2716] bg-[#fffaf0] font-semibold" : "border-transparent hover:bg-[#fffaf0]/70"
                  }`}
                >
                  {runningByConvo[c.id] && (
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#5f8a3c] motion-reduce:animate-none" title="Working" />
                  )}
                  {c.chatMode === "conversation" && <span title="Conversation mode — no tools">💬</span>}
                  <span className="min-w-0 flex-1 truncate">{c.title || "New session"}</span>
                  {unreadByConvo[c.id] > 0 && (
                    <span className="rounded-full bg-[#2f5f9a] px-1.5 text-[10px] font-bold text-white" title="New messages">
                      {unreadByConvo[c.id]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="flex min-w-0 flex-1 flex-col">
          {/* The conversation's own bar: pick, rename, delete, mode. */}
          <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-[#d8c49a] px-3 py-2 text-xs">
            {renaming !== null && active ? (
              <form
                className="flex min-w-0 flex-1 gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void chat.rename(active.id, renaming);
                  setRenaming(null);
                }}
              >
                <input
                  name="title"
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  autoFocus
                  aria-label="Conversation title"
                  className="min-w-0 flex-1 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 outline-none"
                />
                <button type="submit" className="village-btn village-btn-go px-2 py-1">
                  Save
                </button>
                <button type="button" onClick={() => setRenaming(null)} className="village-btn px-2 py-1">
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <select
                  name="conversation"
                  aria-label="Conversation"
                  value={activeId ?? ""}
                  onChange={(e) => chat.setActiveId(Number(e.target.value))}
                  className="min-w-0 flex-1 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 sm:hidden"
                >
                  {conversations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {label(c)}
                    </option>
                  ))}
                </select>
                <span className="village-pixel hidden min-w-0 flex-1 truncate text-sm sm:block">{active?.title || "New session"}</span>
                <button onClick={() => void chat.newConversation()} className="village-btn px-2 py-1 sm:hidden" aria-label="New conversation">
                  +
                </button>
                <button onClick={() => setRenaming(active?.title ?? "")} disabled={!active} className="village-btn px-2 py-1" title="Rename">
                  ✎<span className="sr-only sm:not-sr-only sm:ml-1">Rename</span>
                </button>
                <button onClick={() => setConfirmDelete(true)} disabled={!active} className="village-btn village-btn-danger px-2 py-1" title="Delete">
                  🗑<span className="sr-only sm:not-sr-only sm:ml-1">Delete</span>
                </button>
                <button
                  onClick={() => void chat.toggleChatMode()}
                  disabled={!activeId}
                  aria-pressed={chatMode === "agentic"}
                  title={
                    chatMode === "agentic"
                      ? "Agentic: the agent may use tools here. Click for conversation mode (no tools)."
                      : "Conversation mode: no tools here. Click to let the agent use tools."
                  }
                  className={`village-btn px-2 py-1 ${chatMode === "agentic" ? "village-btn-go" : ""}`}
                >
                  {chatMode === "agentic" ? "🤖 Agentic" : "💬 Just talk"}
                </button>
                {chat.dailyCost !== null && (
                  <span className="hidden rounded border-2 border-[#d8c49a] px-1.5 py-0.5 font-mono text-[10px] text-[#6b4a2e] sm:inline" title="Spent today">
                    ${chat.dailyCost.toFixed(4)}
                  </span>
                )}
              </>
            )}
          </div>
          {chat.modeError && <p className="border-b-2 border-[#b3261e] bg-[#fbe3df] px-3 py-1 text-[11px] text-[#7a1a14]">{chat.modeError}</p>}

          <MessageList
            msgs={chat.visibleMsgs}
            sending={chat.sending}
            error={chat.error}
            hasMore={chat.hasMore}
            loadingOlder={chat.loadingOlder}
            onLoadOlder={chat.loadOlder}
            onQuickAction={chat.send}
            agentName={agentName}
            theme={VILLAGE_THEME}
          />

          {chat.showTools && (chat.live.length > 0 || chat.liveStatus) && (
            <div className="mx-3 mb-2 rounded border-2 border-[#3b2716] bg-[#1d1a16] text-[#f4ead5]" aria-live="polite">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[#c9b27a]">
                What {agentName} is doing{chat.liveStatus && <span className="ml-1 normal-case text-[#e3b04b]">· {chat.liveStatus}</span>}
              </p>
              <ul className="max-h-36 space-y-1 overflow-y-auto px-2 pb-2">
                {chat.live.length === 0 && <li className="text-[11px] text-[#c9b27a]">waiting for the agent…</li>}
                {chat.live.map((l) => (
                  <li key={l.id} className="rounded border border-[#5a3d25] px-2 py-1 font-mono text-[11px]">
                    <span className="font-semibold">🔧 {l.tool}</span>
                    {l.args && <span className="ml-2 opacity-70">{l.args}</span>}
                    <span className={`ml-2 ${l.status === "running" ? "text-[#e3b04b]" : "opacity-70"}`}>[{l.status}]</span>
                    {l.output && <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap opacity-80">{l.output}</pre>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t-4 border-[#3b2716] bg-[#ead9b4] p-2">
            <div className="flex items-end gap-2">
              <textarea
                name="message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                data-autofocus
                aria-label={`Message to ${agentName}`}
                placeholder={`Ask ${agentName} anything, or give it a task…`}
                className="min-w-0 flex-1 resize-none rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm outline-none"
              />
              {chat.busy ? (
                <button onClick={() => void chat.stop()} className="village-btn village-btn-danger px-3 py-2 text-xs" title={`Stop ${agentName}`}>
                  ⏹ Stop
                </button>
              ) : (
                <button onClick={submit} disabled={!draft.trim()} className="village-btn village-btn-primary px-3 py-2 text-xs">
                  Send
                </button>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <button onClick={() => fileRef.current?.click()} className="village-btn px-2 py-0.5" title="Put a file in the agent's workspace">
                📎 Upload a file
              </button>
              <button onClick={chat.toggleHideChatTools} className="village-btn px-2 py-0.5" aria-pressed={!chat.hideChatTools}>
                {chat.hideChatTools ? "Show tool messages" : "Hide tool messages"}
              </button>
              <button onClick={chat.toggleTools} className="village-btn px-2 py-0.5" aria-pressed={chat.showTools}>
                {chat.showTools ? "Hide live activity" : "Show live activity"}
              </button>
              {chat.uploadMsg && <span className="text-[#6b4a2e]">{chat.uploadMsg}</span>}
            </div>
            <input
              ref={fileRef}
              type="file"
              name="upload"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void chat.uploadFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </section>
      </div>
    </ParchmentDialog>
  );
}

// --- the diary: the journal -------------------------------------------------------

const STATUS_LABEL: Record<JournalEntryRow["status"], { text: string; tone: string }> = {
  open: { text: "open", tone: "#6b4a2e" },
  in_progress: { text: "in progress", tone: "#2f5f9a" },
  done: { text: "done", tone: "#3f6b22" },
  abandoned: { text: "abandoned", tone: "#9a2a4a" },
};

function Diary({ onClose }: { onClose: () => void }) {
  const { entries, loaded, addNote, setStatus, remove } = useJournal();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deleting, setDeleting] = useState<JournalEntryRow | null>(null);

  if (deleting) {
    return (
      <ConfirmDialog
        title="Tear out this page?"
        message={
          <>
            Delete the journal entry <strong>{deleting.title}</strong>? This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete entry"
        onConfirm={() => {
          void remove(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    );
  }

  return (
    <ParchmentDialog kicker="The cottage" title="Diary" onClose={onClose} wide>
      <p className="mb-3 text-xs text-[#6b4a2e]">
        The agent writes here about what it&apos;s exploring, building and thinking — the honest answer to &quot;what have
        you been up to?&quot; You can leave it a note or a task too.
      </p>
      <form
        className="mb-4 rounded border-2 border-dashed border-[#c9b27a] p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await addNote(title, body);
          setTitle("");
          setBody("");
        }}
      >
        <p className="village-pixel mb-2 text-xs">Leave a note</p>
        <input
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mb-2 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm outline-none"
        />
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Details (optional)"
          className="mb-2 w-full resize-y rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm outline-none"
        />
        <button type="submit" disabled={!title.trim()} className="village-btn village-btn-primary px-3 py-1.5 text-xs">
          ✒ Add note
        </button>
      </form>

      {!loaded && <p className="text-sm">Opening the diary…</p>}
      {loaded && entries.length === 0 && <p className="text-sm">No entries yet — ask the agent what it&apos;s working on to get it started.</p>}
      <ul className="space-y-2">
        {entries.map((e) => {
          const st = STATUS_LABEL[e.status];
          return (
            <li key={e.id} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2">
              <div className="flex flex-wrap items-start gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold">
                  <span aria-hidden className="mr-1">
                    {JOURNAL_ICON[e.category] || "🗒️"}
                  </span>
                  {e.title}
                </p>
                <span className="text-[11px] font-semibold" style={{ color: st.tone }}>
                  {st.text}
                </span>
              </div>
              {e.body && <p className="mt-1 whitespace-pre-wrap text-xs text-[#5a3d25]">{e.body}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[#6b4a2e]">
                <span>
                  {e.category} · {new Date(e.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="ml-auto flex gap-1.5">
                  {e.status !== "done" && (
                    <button onClick={() => void setStatus(e.id, "done")} className="village-btn village-btn-go px-2 py-0.5">
                      Mark done
                    </button>
                  )}
                  <button onClick={() => setDeleting(e)} className="village-btn village-btn-danger px-2 py-0.5">
                    Delete
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </ParchmentDialog>
  );
}
