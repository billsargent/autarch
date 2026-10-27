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

const ICON: Record<string, string> = { friend: "🤝", level: "⭐", visit: "🫖" };

export default function Chronicle({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [events, setEvents] = useState<LifeEvent[] | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await fetch("/api/life/chronicle", { cache: "no-store" }).then((r) => r.json());
      if (Array.isArray(data.events)) setEvents(data.events);
    } catch {
      /* keep what we have */
    }
  }, []);
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
