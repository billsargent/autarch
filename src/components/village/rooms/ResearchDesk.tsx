"use client";

import { useCallback, useEffect, useState } from "react";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";

// The research desk in the library (#170): commission research from the
// librarians and follow it to the report on the research shelf.

interface Project {
  id: number;
  topic: string;
  brief: string | null;
  depth: "quick" | "thorough";
  budgetUsd: number;
  deadline: number;
  status: "planning" | "researching" | "writing" | "done" | "failed" | "cancelled";
  leadId: number;
  helperIds: number[];
  report: string | null;
  note: string | null;
  questions: number;
  questionsDone: number;
  notes: number;
  spentUsd: number;
}

const STATUS: Record<Project["status"], string> = {
  planning: "Planning the questions",
  researching: "Researching",
  writing: "Writing the report",
  done: "Done: on the research shelf",
  failed: "Didn't work out",
  cancelled: "Cancelled",
};
const input = "mt-1 block w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 font-normal";

export default function ResearchDesk({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { villagers } = useVillagers(30000);
  const working = villagers.filter((v) => v.status === "active");
  const librarians = working.filter((v) => (v.life?.trade ?? v.trade) === "scholar");
  const [form, setForm] = useState({ topic: "", brief: "", depth: "quick", budgetUsd: "0.50", deadlineDays: "3", leadId: 0, helperIds: [] as number[] });
  const lead = form.leadId || librarians[0]?.id || working[0]?.id || 0;

  const load = useCallback(async () => {
    try {
      setProjects((await fetch("/api/research", { cache: "no-store" }).then((r) => r.json())).projects ?? []);
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    const id = setInterval(load, 15000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [load]);

  async function start() {
    setError(null);
    const res = await fetch("/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, budgetUsd: Number(form.budgetUsd), deadlineDays: Number(form.deadlineDays), leadId: lead }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? `HTTP ${res.status}`);
    setForm((f) => ({ ...f, topic: "", brief: "" }));
    await load();
  }

  async function stop(id: number) {
    await fetch("/api/research", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: "cancel" }) });
    await load();
  }

  const nameOf = (id: number) => villagers.find((v) => v.id === id)?.name ?? "a villager";
  return (
    <ParchmentDialog kicker="The library" title="The research desk" onClose={onClose} wide>
      <p className="mb-2 text-xs text-[#6b4a2e]">
        Ask the librarians to research a topic. The lead splits it into questions and shares them out; each searches the web, reads
        the best sources and notes what they found; then the lead writes a report that cites every source. It goes on the research shelf
        at the reading table. Each project has its own budget, apart from the daily limits. Fetching from the web must be on (Mayor&apos;s
        ledger → Limits).
      </p>
      <div className="space-y-2 rounded border-2 border-[#3b2716] bg-[#fffaf0]/60 p-3 text-xs">
        <label className="block font-semibold">
          What to research
          <input name="topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="e.g. The Battle of Britain: causes, course and outcome" className={input} />
        </label>
        <label className="block font-semibold">
          Anything to focus on (optional)
          <textarea name="brief" value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} rows={2} className={`${input} resize-y`} />
        </label>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block font-semibold">
            How deep
            <select name="depth" value={form.depth} onChange={(e) => setForm({ ...form, depth: e.target.value })} className={input}>
              <option value="quick">Quick (2–3 questions)</option>
              <option value="thorough">Thorough (4–6 questions)</option>
            </select>
          </label>
          <label className="block font-semibold">
            Budget (USD)
            <input name="budgetUsd" type="number" step="0.1" min="0.05" value={form.budgetUsd} onChange={(e) => setForm({ ...form, budgetUsd: e.target.value })} className={input} />
          </label>
          <label className="block font-semibold">
            Within (days)
            <input name="deadlineDays" type="number" min="1" max="30" value={form.deadlineDays} onChange={(e) => setForm({ ...form, deadlineDays: e.target.value })} className={input} />
          </label>
          <label className="block font-semibold">
            Led by
            <select name="leadId" value={lead} onChange={(e) => setForm({ ...form, leadId: Number(e.target.value), helperIds: form.helperIds.filter((h) => h !== Number(e.target.value)) })} className={input}>
              {working.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {librarians.some((l) => l.id === v.id) ? " (librarian)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="font-semibold">Helping (optional)</legend>
          <div className="flex flex-wrap gap-x-3">
            {working
              .filter((v) => v.id !== lead)
              .map((v) => (
                <label key={v.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.helperIds.includes(v.id)}
                    onChange={(e) => setForm({ ...form, helperIds: e.target.checked ? [...form.helperIds, v.id] : form.helperIds.filter((h) => h !== v.id) })}
                  />
                  {v.name}
                </label>
              ))}
          </div>
        </fieldset>
        <button onClick={() => void start()} disabled={!form.topic.trim() || !lead} className="village-btn village-btn-go px-3 py-1.5 text-xs disabled:opacity-50">
          📚 Commission the research
        </button>
        {error && <p role="alert" className="text-[#b3261e]">{error}</p>}
      </div>

      <p className="mt-3 text-xs font-semibold">Projects</p>
      {!projects && <p className="text-sm">Looking at the board…</p>}
      {projects?.length === 0 && <p className="text-xs text-[#6b4a2e]">None yet.</p>}
      <ul className="mt-1 space-y-1.5">
        {projects?.map((p) => (
          <li key={p.id} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">📜 {p.topic}</span>
              <span className="ml-auto font-semibold text-[#8a5a2b]">{STATUS[p.status]}</span>
            </div>
            <p className="text-[11px] text-[#6b4a2e]">
              Led by {nameOf(p.leadId)}
              {p.helperIds.length ? `, with ${p.helperIds.map(nameOf).join(", ")}` : ""} · {p.depth} · questions {p.questionsDone}/{p.questions} · {p.notes} finding
              {p.notes === 1 ? "" : "s"} · ${p.spentUsd.toFixed(2)} of ${p.budgetUsd.toFixed(2)}
            </p>
            {p.note && <p className="text-[11px]">{p.note}</p>}
            <div className="mt-1 flex gap-1.5">
              {p.report && (
                <a href={`/api/library/research/${encodeURIComponent(p.report)}`} target="_blank" rel="noreferrer" className="village-btn px-2 py-0.5 text-[11px]">
                  📄 Read the report
                </a>
              )}
              {["planning", "researching", "writing"].includes(p.status) && (
                <button onClick={() => void stop(p.id)} className="village-btn village-btn-danger px-2 py-0.5 text-[11px]">
                  Stop it
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </ParchmentDialog>
  );
}
