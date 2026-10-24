"use client";

import { useEffect, useRef } from "react";

// Live updates (#74): one event stream per tab (/api/events), shared by
// every hook. A hook names the kinds of change it cares about and gets called
// (debounced) when one happens; a slow fallback poll covers a dropped stream.

export type LiveKind =
  | "message"
  | "conversation"
  | "session"
  | "tool"
  | "notification"
  | "settings"
  | "job"
  | "goal"
  | "journal"
  | "agent"
  | "hire"
  | "meeting"
  | "idea"
  | "building"
  | "draft";

export interface LiveEvent {
  kind: LiveKind;
  ref: number | null;
  conversationId: number | null;
}

type Listener = (events: LiveEvent[]) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function connect() {
  if (source || typeof window === "undefined" || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  source.onmessage = (e) => {
    let events: LiveEvent[] = [];
    try {
      events = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const l of listeners) l(events);
  };
}

function disconnect() {
  if (listeners.size || !source) return;
  source.close();
  source = null;
}

// The fallback when the stream is down: much slower than the old timers.
export const FALLBACK_MS = 60_000;

// Calls `onChange` (at most every `debounceMs`) when a change of one of
// `kinds` happens, optionally only for one conversation.
export function useLive(kinds: LiveKind[], onChange: () => void, opts?: { conversationId?: number | null; debounceMs?: number }) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  const key = kinds.join(",");
  const conversationId = opts?.conversationId;
  const debounceMs = opts?.debounceMs ?? 250;
  useEffect(() => {
    const wanted = new Set(key.split(","));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const listener: Listener = (events) => {
      const hit = events.some((e) => wanted.has(e.kind) && (conversationId == null || e.conversationId == null || e.conversationId === conversationId));
      if (!hit || timer) return;
      timer = setTimeout(() => {
        timer = null;
        latest.current();
      }, debounceMs);
    };
    listeners.add(listener);
    connect();
    return () => {
      listeners.delete(listener);
      if (timer) clearTimeout(timer);
      disconnect();
    };
  }, [key, conversationId, debounceMs]);
}
