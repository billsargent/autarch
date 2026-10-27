"use client";

import { useCallback, useEffect, useState } from "react";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";

// Letters between villagers (#172), for the owner: every thread at the post
// office's letter rack, or one villager's in their cottage's letter drawer.
// Looking doesn't mark a letter read for the villager it's addressed to.

interface Letter {
  id: number;
  fromId: number;
  toId: number;
  subject: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}
interface Thread {
  threadId: number;
  subject: string;
  people: number[];
  letters: Letter[];
  lastAt: number;
  unread: number;
}

const when = (s: number) => new Date(s * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function LetterRack({ agentId, kicker, onClose }: { agentId?: number | null; kicker: string; onClose: () => void }) {
  const { villagers, byId } = useVillagers(30000);
  const [who, setWho] = useState<number>(agentId ?? 0);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const name = (id: number) => byId(id)?.name ?? "a villager";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/letters${who ? `?agent=${who}` : ""}`, { cache: "no-store" });
      setThreads(((await res.json()).threads as Thread[]) ?? []);
    } catch {
      /* keep what we have */
    }
  }, [who]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    const id = setInterval(load, 20000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [load]);

  const mine = agentId ? byId(agentId)?.name : null;
  return (
    <ParchmentDialog kicker={kicker} title={mine ? `${mine}'s letters` : "The letter rack"} onClose={onClose} wide>
      <p className="mb-3 text-xs text-[#6b4a2e]">
        {mine
          ? `Letters ${mine} has written and received. They answer theirs in their own time.`
          : "Every letter the villagers have written each other, newest first. A letter waits in the neighbour's mailbox until they read it in their own time."}
      </p>
      {!agentId && (
        <label className="mb-3 block text-xs font-semibold">
          Whose letters
          <select value={who} onChange={(e) => setWho(Number(e.target.value))} className="ml-2 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-0.5 font-normal">
            <option value={0}>Everyone</option>
            {villagers.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!threads && <p className="text-sm">Sorting the post…</p>}
      {threads?.length === 0 && <p className="text-sm">No letters yet.</p>}
      <ul className="space-y-2">
        {threads?.map((t) => (
          <li key={t.threadId} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2.5 text-xs">
            <details>
              <summary className="cursor-pointer">
                <strong>{t.subject}</strong>
                <span className="ml-2 text-[#6b4a2e]">
                  {t.people.map(name).join(" ↔ ")} · {t.letters.length} letter{t.letters.length === 1 ? "" : "s"} · {when(t.lastAt)}
                </span>
                {t.unread > 0 && <span className="ml-2 font-semibold text-[#b3261e]">{t.unread} unread</span>}
              </summary>
              <ol className="mt-2 space-y-2">
                {t.letters.map((l) => (
                  <li key={l.id} className="rounded border border-[#d8c49a] bg-white/60 p-2">
                    <p className="text-[11px] text-[#6b4a2e]">
                      #{l.id} · {name(l.fromId)} to {name(l.toId)} · {when(l.createdAt)} · {l.readAt ? `read ${when(l.readAt)}` : "not read yet"}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px]">{l.body}</p>
                  </li>
                ))}
              </ol>
            </details>
          </li>
        ))}
      </ul>
    </ParchmentDialog>
  );
}
