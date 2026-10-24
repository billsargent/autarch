"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FALLBACK_MS, useLive } from "../data/useLive";
import type { MessageRow } from "@/lib/agent/clientTypes";

interface StreamEvent {
  type: string;
  step?: number;
  maxSteps?: number;
  tool?: string;
  content?: string;
  message?: string;
  conversationId?: number;
}

// Loads one conversation and sends messages to it through the streaming chat
// API. A small standalone version of what ChatView does, so the village's talk
// drawer doesn't depend on the full chat page.
// `agentId`: the villager a new conversation is with.
export function useConversation(conversationId: number | null, agentId?: number | null) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/conversations/${id}?limit=40`).then((r) => r.json());
      setMessages(res.messages ?? []);
    } catch {
      /* keep what we have */
    }
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    const first = setTimeout(() => load(conversationId), 0);
    // A slow fallback; live events do the real work (#74).
    const id = setInterval(() => load(conversationId), FALLBACK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [conversationId, load]);
  useLive(["message", "tool", "session"], () => conversationId && void load(conversationId), { conversationId });

  const send = useCallback(
    async (text: string): Promise<number | null> => {
      if (!text.trim() || sending) return null;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSending(true);
      setError(null);
      setStatus("listening…");
      let finalId = conversationId;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, message: text, agentId }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Something went wrong");
          return finalId;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const line = buf.slice(0, idx).split("\n").find((l) => l.startsWith("data: "));
            buf = buf.slice(idx + 2);
            if (!line) continue;
            let evt: StreamEvent;
            try {
              evt = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (evt.type === "step_start") setStatus(`thinking (step ${evt.step} of ${evt.maxSteps})…`);
            else if (evt.type === "model_stream") setStatus(evt.content ? "writing…" : "thinking…");
            else if (evt.type === "tool_start") setStatus(`using ${evt.tool}…`);
            else if (evt.type === "error") setError(evt.message || "Something went wrong");
            else if (evt.type === "done" && evt.conversationId) finalId = evt.conversationId;
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setSending(false);
        setStatus(null);
        abortRef.current = null;
        if (finalId) await load(finalId);
      }
      return finalId;
    },
    [conversationId, agentId, sending, load],
  );

  const stop = useCallback(async () => {
    if (conversationId) {
      await fetch("/api/chat/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      }).catch(() => {});
    }
    abortRef.current?.abort();
  }, [conversationId]);

  return { messages, sending, status, error, send, stop };
}
