"use client";

import { useRef, useState } from "react";
import ChatComposer from "./ChatComposer";
import { useChat } from "./data/useChat";
import { MessageList } from "./MessageList";

export default function ChatView() {
  const chat = useChat();
  const {
    conversations,
    activeId,
    setActiveId,
    runningByConvo,
    unreadByConvo,
    chatMode,
    modeError,
    visibleMsgs,
    live,
    liveStatus,
    showTools,
    hideChatTools,
    agentName,
    dailyCost,
    uploadMsg,
  } = chat;
  const fileRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  async function deleteConversation(id: number) {
    if (!window.confirm("Delete this conversation and all its messages? This cannot be undone.")) return;
    await chat.deleteConversation(id);
  }

  function saveRename(id: number) {
    setRenamingId(null);
    void chat.rename(id, renameTitle);
  }

  return (
    <div className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
        <div className="p-3">
          <button
            onClick={chat.newConversation}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium hover:bg-neutral-800"
          >
            + New session
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2">
          {conversations.map((c) => {
            const running = Boolean(runningByConvo[c.id]);
            const unread = unreadByConvo[c.id] || 0;
            return (
              <div key={c.id} className="group relative">
                {renamingId === c.id ? (
                  <input
                    value={renameTitle}
                    onChange={(e) => setRenameTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename(c.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => saveRename(c.id)}
                    className="block w-full rounded-md border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-xs text-white outline-none"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => setActiveId(c.id)}
                    onDoubleClick={() => {
                      setRenamingId(c.id);
                      setRenameTitle(c.title);
                    }}
                    className={`block w-full truncate rounded-md px-2.5 py-2 pr-14 text-left text-xs ${
                      activeId === c.id ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900"
                    }`}
                  >
                    {running && (
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 align-middle" />
                    )}
                    {c.chatMode === "conversation" && (
                      <span className="mr-1" title="Conversation mode — no tools">
                        💬
                      </span>
                    )}
                    {c.title || "New session"}
                  </button>
                )}
                {unread > 0 && (
                  <span className="absolute right-6 top-1/2 -translate-y-1/2 rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                    {unread}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(c.id);
                  }}
                  title="Delete conversation"
                  className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded px-1 text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-red-400 group-hover:block"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
          <div>
            <h1 className="text-sm font-semibold">Talk to the agent</h1>
            <p className="text-xs text-neutral-500">Ask what it&apos;s working on, give it a task, or just check in.</p>
          </div>
          <div className="flex items-center gap-2">
            {dailyCost !== null && (
              <span
                className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-0.5 font-mono text-[10px] text-neutral-500"
                title="Today's spend"
              >
                ${dailyCost.toFixed(4)}
              </span>
            )}
            {chatMode === "conversation" && (
              <span
                className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[11px] text-neutral-400"
                title="Tools are disabled while in conversation mode"
              >
                tools disabled
              </span>
            )}
            <button
              onClick={chat.toggleChatMode}
              disabled={!activeId}
              title={
                chatMode === "agentic"
                  ? "This conversation is agentic — the agent may use tools. Click to switch this conversation to conversation mode."
                  : "This conversation is in conversation mode — no tools. Click to switch this conversation to agentic mode."
              }
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                chatMode === "agentic"
                  ? "border-cyan-700 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/40"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {chatMode === "agentic" ? "🤖 Agentic" : "💬 Conversation"}
            </button>
          </div>
        </div>
        {modeError && (
          <p className="border-b border-red-900/40 bg-red-950/30 px-6 py-1.5 text-[11px] text-red-300">{modeError}</p>
        )}

        <MessageList
          msgs={visibleMsgs}
          sending={chat.sending}
          error={chat.error}
          hasMore={chat.hasMore}
          loadingOlder={chat.loadingOlder}
          onLoadOlder={chat.loadOlder}
          onQuickAction={chat.send}
          agentName={agentName}
        />

        {showTools && (live.length > 0 || liveStatus) && (
          <div className="border-t border-neutral-800 px-6 pt-3">
            <div className="mx-auto max-w-3xl rounded-xl border border-neutral-800 bg-neutral-950">
              <div className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wide text-neutral-500">
                <span>
                  Live tool activity
                  {liveStatus && <span className="ml-1 normal-case text-blue-400">· {liveStatus}</span>}
                </span>
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto px-2 pb-2">
                {live.length === 0 && <p className="px-1 py-1 text-[11px] text-neutral-600">waiting for the agent…</p>}
                {live.map((l) => (
                  <div key={l.id} className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-neutral-200">🔧 {l.tool}</span>
                      {l.args && <span className="truncate text-neutral-500">{l.args}</span>}
                      <span className={l.status === "running" ? "text-blue-400" : "text-neutral-500"}>
                        [{l.status}]
                      </span>
                    </div>
                    {l.output && (
                      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-neutral-400">{l.output}</pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <ChatComposer
          sending={chat.busy}
          showTools={showTools}
          onToggleTools={chat.toggleTools}
          hideChatTools={hideChatTools}
          onToggleHideChatTools={chat.toggleHideChatTools}
          onSend={chat.send}
          onStop={chat.stop}
          onUploadClick={() => fileRef.current?.click()}
        />
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void chat.uploadFile(f);
            e.target.value = "";
          }}
        />
        {uploadMsg && (
          <p className="border-t border-neutral-800 px-6 pb-3 pt-2 text-center text-[11px] text-neutral-500">
            {uploadMsg}
          </p>
        )}
      </div>
    </div>
  );
}

