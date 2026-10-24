"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";
import VillagerPortrait from "../VillagerPortrait";

// Ideas pinned on the notice board (#98): who proposed what, the latest vote
// with everyone's reasons, and the owner's say: put it to a vote, adopt it
// straight away, or veto it (also after it's adopted).

interface Idea {
  id: number;
  title: string;
  body: string | null;
  proposedBy: number | null;
  status: "open" | "voting" | "adopted" | "rejected" | "vetoed";
  rounds: number;
  goalId: number | null;
  decidedBy: string | null;
  voting: boolean;
  votes: Array<{ agentId: number | null; choice: "yes" | "no" | "abstain"; reason: string | null }>;
}

const STATUS: Record<Idea["status"], { label: string; tone: string }> = {
  open: { label: "Open", tone: "#8a5a2b" },
  voting: { label: "Voting…", tone: "#4f86c6" },
  adopted: { label: "Adopted", tone: "#3d7a2a" },
  rejected: { label: "Turned down", tone: "#b3261e" },
  vetoed: { label: "Vetoed by you", tone: "#6b4a2e" },
};
const CHOICE = { yes: "👍", no: "👎", abstain: "🤷" };

export default function IdeasBoard({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [list, setList] = useState<Idea[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const { byId } = useVillagers(30000);

  // Only the newest answer counts: a slow poll mustn't undo a fresh change.
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await fetch("/api/ideas", { cache: "no-store" }).then((r) => r.json());
      if (mine === seq.current) setList(data.ideas ?? []);
    } catch {
      /* keep what we have */
    }
  }, []);
  const anyVoting = list?.some((i) => i.voting) ?? false;
  useEffect(() => {
    const first = setTimeout(reload, 0);
    const id = setInterval(reload, anyVoting ? 2000 : 10000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload, anyVoting]);

  async function call(url: string, method: string, payload: unknown) {
    setError(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    await reload();
    return res.ok;
  }

  return (
    <ParchmentDialog
      kicker="The village square"
      title="Ideas"
      onClose={onClose}
      wide
      footer={
        <button onClick={onBack} className="village-btn ml-auto px-3 py-2 text-xs">
          ← The goals
        </button>
      }
    >
      <p className="mb-3 text-xs text-[#6b4a2e]">
        Ideas the villagers (or you) pinned up. The village votes once a day in the daytime, or when you or the Mayor call a
        vote: more than half must vote, and more yes than no adopts it as a town goal. You can adopt or veto any idea yourself.
      </p>
      <form
        className="mb-3 rounded border-2 border-dashed border-[#c9b27a] p-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call("/api/ideas", "POST", { title, body })) {
            setTitle("");
            setBody("");
          }
        }}
      >
        <input name="ideaTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pin an idea of your own…" className="w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 text-sm outline-none" />
        {title.trim() && (
          <>
            <textarea name="ideaBody" value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Why, and roughly how (optional)" className="mt-1 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 text-xs outline-none" />
            <button className="village-btn village-btn-primary mt-1 px-3 py-1 text-xs">💡 Pin it</button>
          </>
        )}
      </form>
      {error && <p role="alert" className="mb-2 text-xs text-[#b3261e]">{error}</p>}
      {!list && <p className="text-sm">Reading the board…</p>}
      {list?.length === 0 && <p className="text-sm">No ideas yet. Give villagers free time (Villagers page) and they&apos;ll start pinning some.</p>}
      <ul className="space-y-2">
        {list?.map((idea) => {
          const who = idea.proposedBy ? byId(idea.proposedBy) : null;
          const st = STATUS[idea.voting ? "voting" : idea.status];
          const count = (c: string) => idea.votes.filter((v) => v.choice === c).length;
          return (
            <li key={idea.id} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">💡 {idea.title}</span>
                <span className="ml-auto text-[11px] font-semibold" style={{ color: st.tone }}>
                  {st.label}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#6b4a2e]">
                {who && <VillagerPortrait character={who.character} color={who.color} size={16} />}
                Pinned by {who ? who.name : "you"}
                {idea.rounds > 0 && ` · vote ${idea.rounds}: 👍 ${count("yes")} · 👎 ${count("no")} · 🤷 ${count("abstain")}`}
                {idea.goalId && ` · goal #${idea.goalId}`}
              </p>
              {idea.body && <p className="mt-1 whitespace-pre-wrap text-xs">{idea.body}</p>}
              {idea.votes.length > 0 && (
                <button onClick={() => setOpen(open === idea.id ? null : idea.id)} className="mt-1 text-[11px] underline">
                  {open === idea.id ? "Hide the reasons" : "Why they voted that way"}
                </button>
              )}
              {open === idea.id && (
                <ul className="mt-1 space-y-0.5 text-[11px]">
                  {idea.votes.map((v, i) => (
                    <li key={i}>
                      {CHOICE[v.choice]} <strong>{byId(v.agentId)?.name ?? "A villager"}:</strong> {v.reason}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {idea.status === "open" && !idea.voting && (
                  <>
                    <button onClick={() => void call(`/api/ideas/${idea.id}`, "PATCH", { action: "vote" })} className="village-btn px-2 py-1 text-[11px]">
                      🗳 Put it to a vote
                    </button>
                    <button onClick={() => void call(`/api/ideas/${idea.id}`, "PATCH", { action: "adopt" })} className="village-btn village-btn-go px-2 py-1 text-[11px]">
                      ✅ Adopt it
                    </button>
                  </>
                )}
                {(idea.status === "open" || idea.status === "adopted") && !idea.voting && (
                  <button onClick={() => void call(`/api/ideas/${idea.id}`, "PATCH", { action: "veto" })} className="village-btn village-btn-danger px-2 py-1 text-[11px]">
                    ✋ Veto
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </ParchmentDialog>
  );
}
