"use client";

import { useCallback, useEffect, useState } from "react";
import ParchmentDialog from "../ParchmentDialog";
import { useLive } from "../../data/useLive";

// The village chronicle on the notice board (#137): who became friends, who
// rose in their trade, who dropped in on whom. Written by village life itself.

interface LifeEvent {
  id: number;
  kind: string;
  text: string;
  at: number;
}

const ICON: Record<string, string> = { friend: "🤝", level: "⭐", visit: "🫖", romance: "💕", wedding: "💒", buy: "🛍️", gift: "🎁", order: "🐴" };

export default function Chronicle({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [events, setEvents] = useState<LifeEvent[] | null>(null);
  const [couples, setCouples] = useState<Array<{ a: number; b: number; aName: string; bName: string }>>([]);
  const load = useCallback(async () => {
    try {
      const [data, w] = await Promise.all([
        fetch("/api/life/chronicle", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/life/weddings", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (Array.isArray(data.events)) setEvents(data.events);
      if (Array.isArray(w.couples)) setCouples(w.couples);
    } catch {
      /* keep what we have */
    }
  }, []);
  const decide = async (a: number, b: number, action: "bless" | "not_yet") => {
    await fetch("/api/life/weddings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a, b, action }) }).catch(() => {});
    await load();
  };
  useEffect(() => {
    const t = setTimeout(load, 0);
    const every = setInterval(load, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(every);
    };
  }, [load]);
  useLive(["agent"], load, { debounceMs: 2000 });
  const day = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  let lastDay = "";
  return (
    <ParchmentDialog
      kicker="The notice board"
      title="📰 The village chronicle"
      onClose={onClose}
      wide
      footer={
        <button onClick={onBack} className="village-btn ml-auto px-3 py-2 text-xs">
          Back to the board
        </button>
      }
    >
      <p className="mb-3 text-xs text-[#6b4a2e]">What&apos;s been happening in the villagers&apos; lives, newest first.</p>
      {couples.map((c) => (
        <div key={`${c.a}-${c.b}`} className="mb-2 flex flex-wrap items-center gap-2 rounded border-2 border-[#c2185b] bg-[#fdeef4] px-3 py-2 text-xs">
          <span>
            💒 <strong>{c.aName}</strong> and <strong>{c.bName}</strong> would like to marry.
          </span>
          <span className="ml-auto flex gap-1.5">
            <button onClick={() => void decide(c.a, c.b, "bless")} className="village-btn village-btn-go px-2 py-1 text-[11px]">
              Give your blessing
            </button>
            <button onClick={() => void decide(c.a, c.b, "not_yet")} className="village-btn px-2 py-1 text-[11px]">
              Not yet
            </button>
          </span>
        </div>
      ))}
      {!events && <p className="text-sm">Reading the chronicle…</p>}
      {events?.length === 0 && <p className="rounded border-2 border-dashed border-[#c9b27a] p-4 text-center text-sm">Nothing yet. Give it a day or two.</p>}
      <ul className="space-y-1 text-sm">
        {events?.map((e) => {
          const d = day(e.at);
          const heading = d !== lastDay;
          lastDay = d;
          return (
            <li key={e.id}>
              {heading && <p className="village-pixel mt-2 text-xs text-[#6b4a2e]">{d}</p>}
              <p>
                <span aria-hidden>{ICON[e.kind] ?? "•"} </span>
                {e.text}
              </p>
            </li>
          );
        })}
      </ul>
    </ParchmentDialog>
  );
}
