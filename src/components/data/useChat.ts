"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationRow, MessageRow, ToolExecutionRow } from "@/lib/agent/clientTypes";
import type { ChatMode } from "@/lib/agent/chatMode";

// Everything about talking to the agent: the conversation list (running dots,
// unread counts, per-conversation chat mode), the active conversation's
// messages (paged, polled while it runs), streaming a turn, stopping it, live
// tool activity and uploads. Shared by the Chat page and the cottage, so both
// always behave the same.

export interface LiveItem {
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
  content?: string;
  reasoning?: string;
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

export function formatArgsShort(args: unknown) {
  if (!args || typeof args !== "object") return "";
  const entries = Object.entries(args as Record<string, unknown>);
  if (!entries.length) return "";
  return entries.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
}

const INITIAL_LIMIT = 60;
const OLDER_LIMIT = 100;

// `agentId`: talk with one villager only — their conversations, and new ones
// with them (the cottage). Without it, every conversation (the Chat page).
export function useChat(opts?: { initialConversationId?: number | null; agentId?: number | null }) {
  const agentId = opts?.agentId ?? null;
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(opts?.initialConversationId ?? null);
  const [msgs, setMsgs] = useState<MessageRow[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(true);
  const [hideChatTools, setHideChatTools] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [liveByConvo, setLiveByConvo] = useState<Record<number, LiveItem[]>>({});
  const [liveStatusByConvo, setLiveStatusByConvo] = useState<Record<number, string | null>>({});
  const [runningByConvo, setRunningByConvo] = useState<Record<number, boolean>>({});
  const [unreadByConvo, setUnreadByConvo] = useState<Record<number, number>>({});
  const [modeError, setModeError] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("The agent");
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [dailyCost, setDailyCost] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadSeq = useRef(0);
  const lastActiveRef = useRef<number | null>(null);
  // Chat-mode switches still being saved, by conversation id, so a sidebar poll
  // that started before the save can't flip the toggle back.
  const pendingModes = useRef(new Map<number, ChatMode>());
  const lastMsgIdRef = useRef(0);
  const oldestLoadedRef = useRef<number | null>(null);

  useEffect(() => {
    lastActiveRef.current = activeId;
  }, [activeId]);

  // Chat mode belongs to each conversation (new ones start in the default set
  // in Settings).
  const chatMode: ChatMode = conversations.find((c) => c.id === activeId)?.chatMode ?? "agentic";

  // Live console state for the currently-viewed conversation.
  const live = activeId ? liveByConvo[activeId] || [] : [];
  const liveStatus = activeId ? liveStatusByConvo[activeId] || null : null;

  // Send is disabled and Stop shown while the human is sending, or while the
  // conversation runs a job or agent turn (server-reported).
  const busy = sending || Boolean(runningByConvo[activeId ?? 0]);

  const loadConversations = useCallback(async () => {
    const res = await fetch(agentId ? `/api/conversations?agent=${agentId}` : "/api/conversations").then((r) => r.json());
    let list: ConversationRow[] = res.conversations || [];
    if (!list.length) {
      const created = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId }),
      }).then((r) => r.json());
      list = [created.conversation];
    }
    const pending = pendingModes.current;
    if (pending.size) list = list.map((c) => (pending.has(c.id) ? { ...c, chatMode: pending.get(c.id)! } : c));
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
    // Rebuilt from the server each time, so a finished turn's dot clears (#36).
    setRunningByConvo(runningMap);
    setUnreadByConvo((prev) => ({ ...prev, ...unreadMap }));
  }, [agentId]);

  useEffect(() => {
    const t = setTimeout(loadConversations, 0);
    return () => clearTimeout(t);
  }, [loadConversations]);

  // Who's talking, for the "thinking" line: the villager, or the Mayor.
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => {
        const list: Array<{ id: number; name: string; isMayor: boolean }> = d.agents ?? [];
        const who = list.find((a) => (agentId ? a.id === agentId : a.isMayor));
        if (who) setAgentName(who.name);
      })
      .catch(() => {});
  }, [agentId]);

  // Periodically refresh the list so background work started by jobs (running
  // dots, unread badges, ordering) shows up even when you're not sending.
  useEffect(() => {
    const id = setInterval(loadConversations, 15000);
    return () => clearInterval(id);
  }, [loadConversations]);

  // Periodically refresh today's cost for the header badge.
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
  const loadMessages = useCallback(async (id: number, o?: { older?: boolean }) => {
    const seq = ++loadSeq.current;
    const params = new URLSearchParams();
    if (o?.older && oldestLoadedRef.current != null) {
      params.set("before", String(oldestLoadedRef.current));
      params.set("limit", String(OLDER_LIMIT));
    } else {
      if (lastMsgIdRef.current > 0) params.set("since", String(lastMsgIdRef.current));
      params.set("limit", String(INITIAL_LIMIT));
    }
    const qs = params.toString();
    const res = await fetch(`/api/conversations/${id}${qs ? `?${qs}` : ""}`).then((r) => r.json());

    let incoming: MessageRow[] = res.messages || [];
    // If a `since` poll came back with a full page, keep fetching the remainder so
    // no messages are missed between polls (guard caps the total).
    if (!o?.older && params.has("since") && incoming.length >= INITIAL_LIMIT) {
      for (let guard = 0; guard < 10; guard++) {
        const lastId = incoming[incoming.length - 1].id;
        const p2 = new URLSearchParams();
        p2.set("since", String(lastId));
        p2.set("limit", String(INITIAL_LIMIT));
        const r2 = await fetch(`/api/conversations/${id}?${p2.toString()}`).then((r) => r.json());
        const more: MessageRow[] = r2.messages || [];
        if (!more.length) break;
        incoming = [...incoming, ...more];
        if (more.length < INITIAL_LIMIT) break;
      }
    }

    if (seq !== loadSeq.current) return; // a newer load superseded this one
    setLoadingOlder(false);
    const running = Boolean(res.running);

    if (o?.older) {
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
      const items: LiveItem[] = (res.executions || []).slice(-20).map((e: ToolExecutionRow) => ({
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
  // When it isn't running, still look for messages posted into it from
  // elsewhere (post_message, notify_human, a neighbour's reply) (#37).
  useEffect(() => {
    if (!activeId || activeRunning) return;
    const t = setInterval(() => loadMessages(activeId), 15000);
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
  const sendStable = useCallback((q: string) => sendRef.current(q), []);
  const stop = useCallback(async () => {
    const cid = activeId;
    if (cid) {
      try {
        await fetch("/api/chat/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: cid }),
        });
      } catch {
        /* ignore */
      }
    }
    abortRef.current?.abort();
  }, [activeId]);
  const toggleTools = useCallback(() => setShowTools((v) => !v), []);
  const toggleHideChatTools = useCallback(() => setHideChatTools((v) => !v), []);

  // Tool messages can be hidden from the chat stream for a clean view (tool
  // activity still appears in the live console). Memoized so MessageList
  // (memo) doesn't re-render on unrelated state changes.
  // Hidden tool messages still show a request waiting for approval (#38).
  const visibleMsgs = useMemo(
    () => (hideChatTools ? msgs.filter((m) => m.role !== "tool" || (m.content ?? "").startsWith("PENDING HUMAN APPROVAL")) : msgs),
    [hideChatTools, msgs],
  );

  function handleEvent(convoId: number, evt: StreamEvent) {
    switch (evt.type) {
      case "step_start":
        setLiveStatusByConvo((prev) => ({ ...prev, [convoId]: `working on step ${evt.step} of ${evt.maxSteps}…` }));
        break;
      case "model_stream":
        // Live indicator while the model streams. Show visible answer text only
        // (not the raw chain-of-thought).
        setLiveStatusByConvo((prev) => ({
          ...prev,
          [convoId]: evt.content ? `generating… ${(evt.content || "").slice(0, 60)}` : "thinking…",
        }));
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
        body: JSON.stringify({ conversationId: convoId, message: text, agentId }),
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

  // Delete a conversation and its messages. Callers confirm with the human first.
  async function deleteConversation(id: number) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) {
      setActiveId(null);
      setMsgs([]);
    }
    await loadConversations();
  }

  async function rename(id: number, title: string) {
    const t = title.trim();
    if (!t) return;
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

  // Put a file in the agent's workspace and tell the agent it arrived.
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
    if (!activeId) return;
    const id = activeId;
    const prev = chatMode;
    const next: ChatMode = prev === "agentic" ? "conversation" : "agentic";
    const setMode = (mode: ChatMode) => setConversations((list) => list.map((c) => (c.id === id ? { ...c, chatMode: mode } : c)));
    setModeError(null);
    setMode(next);
    pendingModes.current.set(id, next);
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatMode: next }),
      });
      if (!res.ok) {
        setMode(prev); // revert — the server didn't accept it
        setModeError("Could not switch this conversation's chat mode. Try again.");
      }
    } catch {
      setMode(prev);
      setModeError("Could not reach the server to switch chat mode.");
    } finally {
      pendingModes.current.delete(id);
    }
  }

  async function newConversation() {
    const created = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId }),
    }).then((r) => r.json());
    await loadConversations();
    setActiveId(created.conversation.id);
    setMsgs([]);
  }

  return {
    // conversations
    conversations,
    activeId,
    setActiveId,
    runningByConvo,
    unreadByConvo,
    newConversation,
    deleteConversation,
    rename,
    chatMode,
    toggleChatMode,
    modeError,
    // messages
    visibleMsgs,
    hasMore,
    loadingOlder,
    loadOlder,
    sending,
    busy,
    error,
    send: sendStable,
    stop,
    // live activity and view toggles
    live,
    liveStatus,
    showTools,
    toggleTools,
    hideChatTools,
    toggleHideChatTools,
    // uploads and header
    uploadFile,
    uploadMsg,
    agentName,
    dailyCost,
  };
}
