"use client";

import { useEffect, useState } from "react";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";
import VillagerPortrait from "../VillagerPortrait";

// How everyone's doing (#104): a score per villager from the record (work
// done and dropped, notes from neighbours, when you last talked), with the
// reasons spelled out. No model calls.

interface Morale {
  agentId: number;
  name: string;
  score: number;
  reasons: string[];
}

const tone = (score: number) => (score >= 70 ? "#3d7a2a" : score >= 40 ? "#c58a1b" : "#b3261e");
const face = (score: number) => (score >= 70 ? "😊" : score >= 40 ? "😐" : "😟");

export default function MoraleBoard({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [rows, setRows] = useState<Morale[] | null>(null);
  const { byId } = useVillagers(30000);
  useEffect(() => {
    fetch("/api/morale")
      .then((r) => r.json())
      .then((d) => setRows([...(d.morale ?? [])].sort((a: Morale, b: Morale) => a.score - b.score)))
      .catch(() => setRows([]));
  }, []);
  return (
    <ParchmentDialog
      kicker="The village square"
      title="How everyone's doing"
      onClose={onClose}
      wide
      footer={
        <button onClick={onBack} className="village-btn ml-auto px-3 py-2 text-xs">
          ← The goals
        </button>
      }
    >
      <p className="mb-3 text-xs text-[#6b4a2e]">
        From the last week&apos;s record: what they got done and what was dropped, their neighbours&apos; notes, and when you
        last talked. Lowest first, so whoever needs a word is at the top.
      </p>
      {!rows && <p className="text-sm">Asking around…</p>}
      <ul className="space-y-2">
        {rows?.map((m) => {
          const v = byId(m.agentId);
          return (
            <li key={m.agentId} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2.5">
              <div className="flex items-center gap-2">
                {v && <VillagerPortrait character={v.character} color={v.color} size={28} />}
                <span className="village-pixel text-sm">{m.name}</span>
                <span className="ml-auto text-sm font-semibold" style={{ color: tone(m.score) }}>
                  {face(m.score)} {m.score}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-sm border border-[#3b2716] bg-[#e8dcc2]" role="meter" aria-label={`${m.name}'s morale`} aria-valuenow={m.score} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full" style={{ width: `${m.score}%`, background: tone(m.score) }} />
              </div>
              <p className="mt-1 text-[11px] text-[#6b4a2e]">{m.reasons.length ? m.reasons.join(" · ") : "A quiet week."}</p>
            </li>
          );
        })}
      </ul>
    </ParchmentDialog>
  );
}
