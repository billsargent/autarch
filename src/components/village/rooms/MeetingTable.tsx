"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";
import VillagerPortrait from "../VillagerPortrait";

// The long table in the town hall (#81): call a town meeting, ask it
// something, and everyone attending answers in turn. Same data as
// /api/meetings.

interface MeetingView {
  meeting: { id: number; topic: string | null; calledBy: string; status: string; participants: number[]; speakingAgentId: number | null } | null;
  transcript?: Array<{ id: number; who: string; text: string }>;
  cost?: number;
  cap?: number;
  busy?: boolean;
}

export default function MeetingTable({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<MeetingView | null>(null);
  const [topic, setTopic] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { villagers } = useVillagers(15000);
  const bottom = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      setView(await fetch("/api/meetings").then((r) => r.json()));
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(reload, 0);
    const id = setInterval(reload, view?.busy ? 1500 : 4000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload, view?.busy]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [view?.transcript?.length]);

  async function send(url: string, method: string, body: unknown) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || `HTTP ${res.status}`);
      else setView(data);
      return res.ok;
    } finally {
      setSending(false);
    }
  }

  const m = view?.meeting;
  const byName = (name: string) => villagers.find((v) => v.name === name);

  if (!view) {
    return (
      <ParchmentDialog kicker="The town hall" title="The long table" onClose={onClose}>
        <p className="text-sm">Pulling up chairs…</p>
      </ParchmentDialog>
    );
  }

  if (!m) {
    return (
      <ParchmentDialog kicker="The town hall" title="Call a town meeting" onClose={onClose}>
        <p className="mb-3 text-xs text-[#6b4a2e]">
          Everyone awake gathers round the table. Ask them something and each answers in turn: the Mayor first, then the others
          (up to six). A meeting stops when it has spent its budget (Mayor&apos;s ledger → Limits).
        </p>
        <label className="block text-xs font-semibold">
          What&apos;s it about? (optional)
          <input
            name="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. What should we work on this week?"
            className="mt-1 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm font-normal outline-none"
          />
        </label>
        {error && <p role="alert" className="mt-2 text-xs text-[#b3261e]">{error}</p>}
        <button disabled={sending} onClick={() => void send("/api/meetings", "POST", { topic })} className="village-btn village-btn-go mt-3 px-4 py-2 text-xs">
          🏛 Call the meeting
        </button>
      </ParchmentDialog>
    );
  }

  const speaking = villagers.find((v) => v.id === m.speakingAgentId);
  return (
    <ParchmentDialog
      kicker="The town hall"
      title={m.topic ? `Town meeting: ${m.topic}` : "Town meeting"}
      onClose={onClose}
      wide
      tall
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-[11px] text-[#6b4a2e]">
            Spent ${(view.cost ?? 0).toFixed(3)} of ${(view.cap ?? 0).toFixed(2)}
          </span>
          <button disabled={sending} onClick={() => void send(`/api/meetings/${m.id}`, "PATCH", { action: "close" })} className="village-btn village-btn-danger ml-auto px-3 py-2 text-xs">
            End the meeting
          </button>
        </div>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="At the meeting">
        {m.participants.map((id) => {
          const v = villagers.find((x) => x.id === id);
          if (!v) return null;
          return (
            <span key={id} className={`flex items-center gap-1 rounded border-2 px-1.5 py-0.5 text-[11px] ${id === m.speakingAgentId ? "border-[#3d7a2a] bg-[#e4f2d8]" : "border-[#d8c49a]"}`}>
              <VillagerPortrait character={v.character} color={v.color} size={18} />
              {v.name}
              {id === m.speakingAgentId && " 💬"}
            </span>
          );
        })}
      </div>
      <ul className="space-y-2">
        {(view.transcript ?? []).map((t) => {
          const v = byName(t.who);
          const mine = t.who === "You";
          return (
            <li key={t.id} className={`flex gap-2 ${mine ? "flex-row-reverse text-right" : ""}`}>
              {v ? <VillagerPortrait character={v.character} color={v.color} size={28} /> : <span className="w-7 text-center text-lg">{mine ? "🙂" : "📜"}</span>}
              <div className={`max-w-[80%] rounded border-2 px-2.5 py-1.5 text-sm ${mine ? "border-[#3b2716] bg-[#f3e1b5]" : "border-[#d8c49a] bg-[#fffaf0]"}`}>
                <p className="text-[11px] font-semibold text-[#6b4a2e]">{t.who}</p>
                <p className="whitespace-pre-wrap">{t.text}</p>
              </div>
            </li>
          );
        })}
        {speaking && <li className="text-xs italic text-[#6b4a2e]">{speaking.name} is speaking…</li>}
      </ul>
      <div ref={bottom} />
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text) return;
          if (await send(`/api/meetings/${m.id}`, "PATCH", { action: "ask", message: text })) setDraft("");
        }}
      >
        <input
          name="message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={view.busy ? "Wait for everyone to answer…" : "Ask the meeting something…"}
          disabled={view.busy}
          className="flex-1 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm outline-none"
        />
        <button disabled={sending || view.busy || !draft.trim()} className="village-btn village-btn-primary px-3 py-1.5 text-xs">
          Ask
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-[#b3261e]">{error}</p>}
    </ParchmentDialog>
  );
}
