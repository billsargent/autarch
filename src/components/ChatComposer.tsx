"use client";

import { useState } from "react";

interface ChatComposerProps {
  sending: boolean;
  showTools: boolean;
  onToggleTools: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onUploadClick: () => void;
}

// Holds its OWN text state so typing only re-renders this small component,
// never the parent's message list (which is the expensive part for long chats).
export default function ChatComposer({
  sending,
  showTools,
  onToggleTools,
  onSend,
  onStop,
  onUploadClick,
}: ChatComposerProps) {
  const [input, setInput] = useState("");

  function submit() {
    const text = input.trim();
    if (!text || sending) return;
    onSend(text);
    setInput("");
  }

  return (
    <div className="border-t border-neutral-800 px-6 py-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask the agent anything, or give it a task…"
          rows={2}
          className="flex-1 resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <div className="flex flex-col gap-2">
          <button
            onClick={onToggleTools}
            title="Show or hide the live tool activity console"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
          >
            {showTools ? "Hide tool actions" : "Show tool actions"}
          </button>
          <button
            onClick={onUploadClick}
            title="Upload a file into the agent's workspace"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
          >
            📎 Upload file
          </button>
        </div>
        <button
          onClick={submit}
          disabled={sending}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
        {sending && (
          <button
            onClick={onStop}
            className="rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
            title="Stop the agent"
          >
            ⏹
          </button>
        )}
      </div>
    </div>
  );
}
