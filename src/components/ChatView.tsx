"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationRow, MessageRow, ToolExecutionRow } from "@/lib/agent/clientTypes";
import ChatComposer from "./ChatComposer";
import { MessageList } from "./MessageList";

interface LiveItem {
  id: number;
  tool: string;
  args: string;
  status: string;
  output: string;
}

interface StreamEvent {
  type: string;
  step?: number;
  maxSteps?: number;
  tool?: string;
  args?: Record<string, unknown>;
  executionId?: number;
  status?: string;
  output?: string;
  conversationId?: number;
  message?: string;
}

// Last-seen message id per conversation, persisted in localStorage so unread
// badges survive reloads and "site not open" gaps.
function readLastSeen(): Record<number, number> {
  try {
    return JSON.parse(localStorage.getItem("chatLastSeen") || "{}") as Record<number, number>;
  } catch {
    return {};
  }
}
function writeLastSeen(v: Record<number, number>) {
  try {
    localStorage.setItem("chatLastSeen", JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

const INITIAL_LIMIT = 60;
const OLDER_LIMIT = 100;

export default function ChatView() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<MessageRow[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [liveByConvo, setLiveByConvo] = useState<Record<number, LiveItem[]>>({});
  const [liveStatusByConvo, setLiveStatusByConvo] = useState<Record<number, string | null>>({});
  const [runningByConvo, setRunningByConvo] = useState<Record<number, boolean>>({});
  const [unreadByConvo, setUnreadByConvo] = useState<Record<number, number>>({});
  const [chatMode, setChatMode] = useState<"agentic" | "conversation">("agentic");
  const [modeError, setModeError] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadSeq = useRef(0);
  const lastActiveRef = useRef<number | null>(null);
  const modeToggleInFlight = useRef(false);
  const lastMsgIdRef = useRef(0);
  const oldestLoadedRef = useRef<number | null>(null);

  const [dailyCost, setDailyCost] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  useEffect(() => {
    lastActiveRef.current = activeId;
  }, [activeId]);

  // Live console state for the currently-viewed conversation.
  const live = activeId ? liveByConvo[activeId] || [] : [];
  const liveStatus = activeId ? liveStatusByConvo[activeId] || null : null;

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations").then((r) => r.json());
    let list: ConversationRow[] = res.conversations || [];
    if (!list.length) {
      const created = await fetch("/api/conversations", { method: "POST" }).then((r) => r.json());
      list = [created.conversation];
    }
    setConversations(list);
    setActiveId((prev) => prev ?? list[0]?.id ?? null);
    const seen = readLastSeen();
    const runningMap: Record<number, boolean> = {};
    const unreadMap: Record<number, number> = {};
    for (const c of list) {
      if (c.running) runningMap[c.id] = true;
      if (c.id !== lastActiveRef.current) {
        const last = c.lastMessageId || 0;
        const s = seen[c.id] || 0;
        if (last > s) unreadMap[c.id] = Math.min(last - s, 99);
      }
    }
    setRunningByConvo((prev) => ({ ...prev, ...runningMap }));
    setUnreadByConvo((prev) => ({ ...prev, ...unreadMap }));
  }, []);

  useEffect(() => {
    const t = setTimeout(loadConversations, 0);
    return () => clearTimeout(t);
  }, [loadConversations]);

  // Load the global chat mode so the header toggle reflects reality, and reconcile
  // periodically so a change made in Settings (or another tab) shows up here.
  useEffect(() => {
    const load = async () => {
      try {
        const d = await fetch("/api/settings").then((r) => r.json());
        if (!modeToggleInFlight.current && d.settings?.chatMode) setChatMode(d.settings.chatMode);
      } catch {
        /* ignore */
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  // Periodically refresh the sidebar so background work started by jobs (running
  // dots, unread badges, ordering) shows up even when you're not sending.
  useEffect(() => {
    const id = setInterval(loadConversations, 15000);
    return () => clearInterval(id);
  }, [loadConversations]);

  // Periodically refresh daily cost for the header badge.
  useEffect(() => {
    const fetchCost = async () => {
      try {
        const d = await fetch("/api/stats").then((r) => r.json());
        setDailyCost(d.today?.costUsd ?? null);
      } catch {
        /* ignore */
      }
    };
    fetchCost();
    const id = setInterval(fetchCost, 30000);
    return () => clearInterval(id);
  }, []);

  // Load messages with pagination:
  //  - initial / poll: latest chunk (`limit`) or only messages newer than the
  //    last one we have (`since`) so long conversations stop re-downloading.
  //  - older: messages before the oldest loaded (`before`) for scroll-up.
  const loadMessages = useCallback(async (id: number, opts?: { older?: boolean }) => {
    const seq = ++loadSeq.current;
    const params = new URLSearchParams();
    if (opts?.older && oldestLoadedRef.current != null) {
      params.set("before", String(oldestLoadedRef.current));
      params.set("limit", String(OLDER_LIMIT));
    } else {
      if (lastMsgIdRef.current > 0) params.set("since", String(lastMsgIdRef.current));
      params.set("limit", String(INITIAL_LIMIT));
    }
    const qs = params.toString();
    const res = await fetch(`/api/conversations/${id}${qs ? `?${qs}` : ""}`).then((r) => r.json());
    if (seq !== loadSeq.current) return; // a newer load superseded this one
    setLoadingOlder(false);

    const incoming: MessageRow[] = res.messages || [];
    const running = Boolean(res.running);

    if (opts?.older) {
      // Prepend older messages; keep existing objects so memoized bubbles skip.
      setMsgs((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const add = incoming.filter((m) => !ids.has(m.id));
        if (!add.length) return prev;
        return [...add, ...prev];
      });
      if (incoming.length) {
        const oldest = Math.min(...incoming.map((m) => m.id));
        oldestLoadedRef.current = oldest;
      }
      setHasMore(Boolean(res.hasMore));
    } else {
      // Merge new messages, dropping optimistic (negative-id) placeholders once
      // the server's real messages arrive. Existing objects are reused.
      setMsgs((prev) => {
        if (!incoming.length) return prev;
        const keep = prev.filter((m) => m.id >= 0);
        const byId = new Map(keep.map((m) => [m.id, m]));
        let changed = keep.length !== prev.length;
        for (const m of incoming) {
          if (!byId.has(m.id)) {
            byId.set(m.id, m);
            changed = true;
          }
        }
        if (!changed) return prev;
        return [...byId.values()].sort((a, b) => a.id - b.id);
      });
      const lastId = incoming.reduce((m: number, x: MessageRow) => Math.max(m, x.id), lastMsgIdRef.current);
      if (lastId > 0) lastMsgIdRef.current = lastId;
      if (incoming.length) {
        const oldest = Math.min(...incoming.map((m) => m.id));
        oldestLoadedRef.current = oldestLoadedRef.current == null ? oldest : Math.min(oldestLoadedRef.current, oldest);
      }
      setHasMore(Boolean(res.hasMore));
    }

    setRunningByConvo((prev) => ({ ...prev, [id]: running }));
    const seen = readLastSeen();
    seen[id] = lastMsgIdRef.current;
    writeLastSeen(seen);
    setUnreadByConvo((prev) => ({ ...prev, [id]: 0 }));

    if (running) {
      const items: LiveItem[] = (res.executions || [])
        .slice(-20)
        .map((e: ToolExecutionRow) => ({
          id: e.id,
          tool: e.tool,
          args: formatArgsShort(e.input),
          status: e.status,
          output: (e.output || e.riskReason || "").slice(0, 400),
        }));
      setLiveByConvo((prev) => ({ ...prev, [id]: items }));
      const steps = res.activeSession?.stepsUsed ?? 0;
      setLiveStatusByConvo((prev) => ({ ...prev, [id]: steps ? `working (step ${steps})…` : "working…" }));
    } else {
      setLiveStatusByConvo((prev) => ({ ...prev, [id]: null }));
    }
  }, []);

  // (Re)load the active conversation's latest chunk whenever it changes.
  useEffect(() => {
    const t = setTimeout(() => {
      if (activeId) {
        lastMsgIdRef.current = 0;
        oldestLoadedRef.current = null;
        setMsgs([]);
        setHasMore(false);
        setLoadingOlder(false);
        loadMessages(activeId);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [activeId, loadMessages]);

  // While the active conversation is mid-turn, poll its detail so live tool
  // activity + messages keep updating even if you switched away and back.
  const activeRunning = activeId ? Boolean(runningByConvo[activeId]) : false;
  useEffect(() => {
    if (!activeId || !activeRunning) return;
    const t = setInterval(() => loadMessages(activeId), 2000);
    return () => clearInterval(t);
  }, [activeId, activeRunning, loadMessages]);

  const loadOlder = useCallback(() => {
    if (!activeId || loadingOlder || !hasMore) return;
    if (oldestLoadedRef.current == null) return;
    setLoadingOlder(true);
    void loadMessages(activeId, { older: true });
  }, [activeId, loadingOlder, hasMore, loadMessages]);

  // Stable callbacks for memoized children: always call the latest `send`.
  const sendRef = useRef<(t: string) => void>(() => {});
  const onQuickAction = useCallback((q: string) => sendRef.current(q), []);
  const onStop = useCallback(() => abortRef.current?.abort(), []);
  const onToggleTools = useCallback(() => setShowTools((v) => !v), []);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const convoId = activeId;
    setSending(true);
    setError(null);
    setLiveByConvo((prev) => ({ ...prev, [convoId ?? 0]: [] }));
    setLiveStatusByConvo((prev) => ({ ...prev, [convoId ?? 0]: "connecting…" }));
    if (convoId) setRunningByConvo((prev) => ({ ...prev, [convoId]: true }));
    setMsgs((prev) => [
      ...prev,
      {
        id: -Date.now(),
        conversationId: convoId || 0,
        role: "user",
        content: text,
        reasoning: null,
        toolCallId: null,
        toolName: null,
        toolArgs: null,
        toolCalls: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: convoId, message: text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong");
        if (convoId) setLiveStatusByConvo((prev) => ({ ...prev, [convoId]: null }));
        if (convoId) loadMessages(convoId);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (evt.type === "done") {
            const cid = evt.conversationId ?? convoId ?? 0;
            setRunningByConvo((prev) => ({ ...prev, [cid]: false }));
            setLiveByConvo((prev) => ({ ...prev, [cid]: [] }));
            setLiveStatusByConvo((prev) => ({ ...prev, [cid]: null }));
            // Only switch back if the user is still looking at this conversation;
            // otherwise leave them where they are and just refresh the lists.
            if (cid && lastActiveRef.current === cid) {
              setActiveId(cid);
              loadMessages(cid);
            }
            loadConversations();
          } else if (evt.type === "error") {
            setError(evt.message || "Something went wrong");
            if (convoId) setLiveStatusByConvo((prev) => ({ ...prev, [convoId]: null }));
            if (convoId) loadMessages(convoId);
          } else {
            handleEvent(convoId ?? 0, evt);
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Turn cancelled.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      if (convoId) setLiveStatusByConvo((prev) => ({ ...prev, [convoId]: null }));
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }
  sendRef.current = send;

  function handleEvent(convoId: number, evt: StreamEvent) {
    switch (evt.type) {
      case "step_start":
        setLiveStatusByConvo((prev) => ({ ...prev, [convoId]: `working on step ${evt.step} of ${evt.maxSteps}…` }));
        break;
      case "tool_start":
        setLiveByConvo((prev) => ({
          ...prev,
          [convoId]: [
            ...(prev[convoId] || []),
            {
              id: evt.executionId ?? Date.now(),
              tool: evt.tool || "?",
              args: formatArgsShort(evt.args),
              status: "running",
              output: "",
            },
          ],
        }));
        setLiveStatusByConvo((prev) => ({ ...prev, [convoId]: `running ${evt.tool}…` }));
        break;
      case "tool_result":
        setLiveByConvo((prev) => ({
          ...prev,
          [convoId]: (prev[convoId] || []).map((l) =>
            l.id === evt.executionId ? { ...l, status: evt.status || "done", output: (evt.output || "").slice(0, 400) } : l,
          ),
        }));
        break;
    }
  }

  async function deleteConversation(id: number) {
    if (!window.confirm("Delete this conversation and all its messages? This cannot be undone.")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) {
      setActiveId(null);
      setMsgs([]);
    }
    await loadConversations();
  }

  async function saveRename(id: number) {
    const t = renameTitle.trim();
    if (!t) {
      setRenamingId(null);
      return;
    }
    setRenamingId(null);
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      await loadConversations();
    } catch {
      /* ignore */
    }
  }

  async function uploadFile(file: File) {
    setUploadMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/files", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setUploadMsg(`upload failed: ${data.error || "unknown error"}`);
        return;
      }
      setUploadMsg(`uploaded ${data.filename} (${data.size} bytes) → ${data.path}`);
      // Inject a system event so the agent knows the file arrived.
      if (activeId) {
        try {
          await fetch(`/api/conversations/${activeId}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              role: "event",
              content: `[UPLOAD] Human uploaded ${data.filename} (${data.size} bytes) → ${data.path}`,
            }),
          });
          loadConversations();
          loadMessages(activeId);
        } catch {
          /* best-effort */
        }
      }
    } catch (e) {
      setUploadMsg(`upload failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function toggleChatMode() {
    const prev = chatMode;
    const next: "agentic" | "conversation" = prev === "agentic" ? "conversation" : "agentic";
    setModeError(null);
    setChatMode(next);
    modeToggleInFlight.current = true;
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatMode: next }),
      });
      if (!res.ok) {
        setChatMode(prev); // revert — the server didn't accept it
        setModeError("Could not switch chat mode. Check Settings and try again.");
      }
    } catch {
      setChatMode(prev);
      setModeError("Could not reach the server to switch chat mode.");
    } finally {
      modeToggleInFlight.current = false;
    }
  }

  async function newConversation() {
    const created = await fetch("/api/conversations", { method: "POST" }).then((r) => r.json());
    await loadConversations();
    setActiveId(created.conversation.id);
    setMsgs([]);
  }

  return (
    <div className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
        <div className="p-3">
          <button
            onClick={newConversation}
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
              onClick={toggleChatMode}
              title={
                chatMode === "agentic"
                  ? "Agentic mode — may use tools. Click to switch to conversation mode."
                  : "Conversation mode — no tools. Click to switch to agentic mode."
              }
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
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
          msgs={msgs}
          sending={sending}
          error={error}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          onQuickAction={onQuickAction}
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
          sending={sending}
          showTools={showTools}
          onToggleTools={onToggleTools}
          onSend={onQuickAction}
          onStop={onStop}
          onUploadClick={() => fileRef.current?.click()}
        />
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
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

function formatArgsShort(args: unknown) {
  if (!args || typeof args !== "object") return "";
  const entries = Object.entries(args as Record<string, unknown>);
  if (!entries.length) return "";
  return entries.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
}
