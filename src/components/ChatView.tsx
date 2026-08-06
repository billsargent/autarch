"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ConversationRow, MessageRow, ToolExecutionRow } from "@/lib/agent/clientTypes";
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

export default function ChatView() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<MessageRow[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(true);
  const [liveByConvo, setLiveByConvo] = useState<Record<number, LiveItem[]>>({});
  const [liveStatusByConvo, setLiveStatusByConvo] = useState<Record<number, string | null>>({});
  const [runningByConvo, setRunningByConvo] = useState<Record<number, boolean>>({});
  const [unreadByConvo, setUnreadByConvo] = useState<Record<number, number>>({});
  const [chatMode, setChatMode] = useState<"agentic" | "conversation">("agentic");
  const [modeError, setModeError] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadSeq = useRef(0);
  const lastActiveRef = useRef<number | null>(null);
  const modeToggleInFlight = useRef(false);

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
      } catch { /* ignore */ }
    };
    fetchCost();
    const id = setInterval(fetchCost, 30000);
    return () => clearInterval(id);
  }, []);

  const loadMessages = useCallback(async (id: number) => {
    const seq = ++loadSeq.current;
    const res = await fetch(`/api/conversations/${id}`).then((r) => r.json());
    if (seq !== loadSeq.current) return; // a newer load superseded this one
    setMsgs(res.messages || []);
    setRunningByConvo((prev) => ({ ...prev, [id]: Boolean(res.running) }));
    const lastId = (res.messages || []).reduce((m: number, x: MessageRow) => Math.max(m, x.id), 0);
    const seen = readLastSeen();
    seen[id] = lastId;
    writeLastSeen(seen);
    setUnreadByConvo((prev) => ({ ...prev, [id]: 0 }));
    if (res.running) {
      const items: LiveItem[] = (res.executions || [])
        .slice(-20)
        .map((e: ToolExecutionRow) => ({
          id: e.id,
          tool: e.tool,
          args: formatArgs(e.input),
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

  useEffect(() => {
    const t = setTimeout(() => {
      if (activeId) loadMessages(activeId);
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

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
    setInput("");
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
              args: formatArgs(evt.args),
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
    if (!t) { setRenamingId(null); return; }
    setRenamingId(null);
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      await loadConversations();
    } catch { /* ignore */ }
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
            body: JSON.stringify({ role: "event", content: `[UPLOAD] Human uploaded ${data.filename} (${data.size} bytes) → ${data.path}` }),
          });
          loadConversations();
          if (activeId) loadMessages(activeId);
        } catch { /* best-effort */ }
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
                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(c.id); if (e.key === "Escape") setRenamingId(null); }}
                    onBlur={() => saveRename(c.id)}
                    className="block w-full rounded-md border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-xs text-white outline-none"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => setActiveId(c.id)}
                    onDoubleClick={() => { setRenamingId(c.id); setRenameTitle(c.title); }}
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

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {msgs.length === 0 && (
            <div className="mx-auto mt-10 max-w-lg text-center text-sm text-neutral-500">
              <p className="mb-4">No messages yet. Try one of these:</p>
              <div className="flex flex-col gap-2">
                {QUICK_ACTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-left text-xs hover:border-neutral-600"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {msgs.map((m) => {
              if (m.role === "user") {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm text-white">
                      {m.content}
                    </div>
                  </div>
                );
              }
              if (m.role === "event") {
                return (
                  <div key={m.id} className="mx-auto rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-[11px] text-neutral-400">
                    {m.content}
                  </div>
                );
              }
              if (m.role === "assistant") {
                if (!m.content && !m.reasoning) return null;
                return (
                  <div key={m.id} className="flex justify-start">
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
              if (m.role === "tool") {
                const badge = toolBadge(m.content);
                return (
                  <div key={m.id} className={`rounded-xl border px-3 py-2 text-xs ${toolCardStyle(m.content)}`}>
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
              return null;
            })}
            {sending && <div className="text-xs text-neutral-500">Root is thinking / acting…</div>}
            {error && <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>}
            <div ref={bottomRef} />
          </div>
        </div>

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
                {live.length === 0 && (
                  <p className="px-1 py-1 text-[11px] text-neutral-600">waiting for the agent…</p>
                )}
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

        <div className="border-t border-neutral-800 px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask the agent anything, or give it a task…"
              rows={2}
              className="flex-1 resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowTools((v) => !v)}
                title="Show or hide the live tool activity console"
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
              >
                {showTools ? "Hide tool actions" : "Show tool actions"}
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                title="Upload a file into the agent's workspace"
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
              >
                📎 Upload file
              </button>
            </div>
            <button
              onClick={() => send(input)}
              disabled={sending}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
            {sending && (
              <button
                onClick={() => abortRef.current?.abort()}
                className="rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
                title="Stop the agent"
              >
                ⏹
              </button>
            )}
          </div>
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
          {uploadMsg && <p className="mx-auto mt-2 max-w-3xl text-[11px] text-neutral-500">{uploadMsg}</p>}
        </div>
      </div>
    </div>
  );
}
