"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";

// The outbox tray on the owner's desk (#107): everything the villagers wrote
// for the outside world. Nothing leaves until the owner approves it.

export interface DraftRow {
  id: number;
  kind: "email" | "event" | "post" | "listing" | "message" | "other";
  target: string | null;
  subject: string | null;
  content: string;
  status: "draft" | "approved" | "sent" | "discarded" | "failed";
  sendResult: string | null;
  agentId: number | null;
  conversationId: number | null;
  createdAt: string;
  // Why the villager wrote it, and any addresses never emailed before (#143).
  why: string | null;
  newRecipients?: string[];
  sentAt?: string | null;
  // A calendar event's when and where (#142).
  details?: { start: string; end: string; allDay: boolean; location: string | null } | null;
}

// "a@x.com, B <b@y.org>": is every part an email address? (email.ts checks again.)
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export const validRecipients = (to: string) => {
  const parts = to.split(/[,;]/).map((p) => (/<([^>]+)>/.exec(p)?.[1] ?? p).trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => EMAIL.test(p));
};

function eventWhen(d: NonNullable<DraftRow["details"]>) {
  const start = new Date(d.start);
  const end = new Date(d.end);
  const day = (x: Date) => x.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const time = (x: Date) => x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.allDay) return day(start) === day(end) ? `${day(start)}, all day` : `${day(start)} – ${day(end)}, all day`;
  return day(start) === day(end) ? `${day(start)}, ${time(start)}–${time(end)}` : `${day(start)} ${time(start)} – ${day(end)} ${time(end)}`;
}

const ICON: Record<DraftRow["kind"], string> = { email: "✉", event: "🗓", post: "📣", listing: "🏷", message: "💬", other: "📄" };
const STATUS: Record<DraftRow["status"], string> = {
  draft: "Waiting for you",
  approved: "Approved: ready for you to send",
  sent: "Sent",
  discarded: "Discarded",
  failed: "Couldn't be sent",
};

export function useDrafts() {
  const [list, setList] = useState<DraftRow[] | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await fetch("/api/drafts", { cache: "no-store" }).then((r) => r.json());
      if (mine === seq.current) setList(data.drafts ?? []);
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);
  return { list, reload, waiting: list?.filter((d) => d.status === "draft") ?? [] };
}

export default function Outbox({ onClose, kicker = "Your home" }: { onClose: () => void; kicker?: string }) {
  const { list, reload } = useDrafts();
  const { byId } = useVillagers(30000);
  // The owner's changes before it goes: the words, and for an email, who to and the subject.
  const [edits, setEdits] = useState<Record<number, { content?: string; target?: string; subject?: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  const edit = (id: number, patch: { content?: string; target?: string; subject?: string }) => setEdits((m) => ({ ...m, [id]: { ...m[id], ...patch } }));

  async function decide(d: DraftRow, action: "approve" | "discard" | "retry") {
    setError(null);
    const res = await fetch(`/api/drafts/${d.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, edits: action === "approve" ? edits[d.id] : undefined }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    await reload();
  }
  // Sent and discarded drafts are tucked away unless asked for.
  const done = (d: DraftRow) => d.status === "sent" || d.status === "discarded";
  const shown = list?.filter((d) => showDone || !done(d));
  const hidden = (list?.length ?? 0) - (shown?.length ?? 0);

  return (
    <ParchmentDialog kicker={kicker} title="The outbox" onClose={onClose} wide>
      <p className="mb-3 text-xs text-[#6b4a2e]">
        Emails, posts, listings and messages the villagers wrote for the outside world, each with who wrote it and why. Nothing
        is ever sent without you: read it, change it if you like, then approve or discard it. Approved emails go from your own
        account (Mayor&apos;s ledger → Email); anything else is marked ready, and you copy it and send it yourself.
      </p>
      {error && <p role="alert" className="mb-2 text-xs text-[#b3261e]">{error}</p>}
      {!list && <p className="text-sm">Sorting the post…</p>}
      {shown?.length === 0 && <p className="text-sm">Nothing waiting. The tray is empty.</p>}
      <ul className="space-y-2">
        {shown?.map((d) => {
          const who = byId(d.agentId);
          const text = edits[d.id]?.content ?? d.content;
          const to = edits[d.id]?.target ?? d.target ?? "";
          const noAddress = d.kind === "email" && d.status === "draft" && !validRecipients(to);
          return (
            <li key={d.id} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {ICON[d.kind]} {edits[d.id]?.subject ?? (d.subject || `A ${d.kind}`)}
                </span>
                <span className="ml-auto font-semibold text-[#8a5a2b]">{STATUS[d.status]}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-[#6b4a2e]">
                From {who?.name ?? "a villager"}
                {d.target && !(d.kind === "email" && d.status === "draft") && ` · to ${d.target}`} · {new Date(d.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
              {d.why && (
                <p className="mt-1 rounded bg-[#f4ead5] px-2 py-1 text-[11px]">
                  💭 <strong>Why:</strong> {d.why}
                  {d.agentId != null && (
                    <>
                      {" "}
                      <a href={`/village/cottage?agent=${d.agentId}&open=chat.open`} className="underline">
                        See {who?.name ?? "their"}&apos;s conversations
                      </a>
                    </>
                  )}
                </p>
              )}
              {d.kind === "event" && d.details && (
                <p className="mt-1 text-[11px]">
                  🗓 <strong>{eventWhen(d.details)}</strong>
                  {d.details.location && <> · 📍 {d.details.location}</>}
                </p>
              )}
              {d.kind === "email" && d.status === "draft" && (
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  <label className="text-[11px] font-semibold">
                    To
                    <input
                      name={`to-${d.id}`}
                      value={to}
                      onChange={(e) => edit(d.id, { target: e.target.value })}
                      placeholder="name@example.com"
                      className={`mt-0.5 block w-full rounded border-2 bg-white px-2 py-1 font-normal ${noAddress ? "border-[#b3261e]" : "border-[#3b2716]"}`}
                    />
                  </label>
                  <label className="text-[11px] font-semibold">
                    Subject
                    <input
                      name={`subject-${d.id}`}
                      value={edits[d.id]?.subject ?? d.subject ?? ""}
                      onChange={(e) => edit(d.id, { subject: e.target.value })}
                      className="mt-0.5 block w-full rounded border-2 border-[#3b2716] bg-white px-2 py-1 font-normal"
                    />
                  </label>
                </div>
              )}
              {noAddress && <p className="mt-1 text-[11px] font-semibold text-[#b3261e]">⚠ Add an email address in To before sending it.</p>}
              {!noAddress && !edits[d.id]?.target && (d.newRecipients?.length ?? 0) > 0 && (
                <p className="mt-1 text-[11px] font-semibold text-[#8a5a2b]">⚠ Never emailed before: {d.newRecipients!.join(", ")}</p>
              )}
              {d.status === "draft" ? (
                <textarea
                  name={`draft-${d.id}`}
                  value={text}
                  onChange={(e) => edit(d.id, { content: e.target.value })}
                  rows={Math.min(10, Math.max(3, text.split("\n").length))}
                  className="mt-1 w-full resize-y rounded border-2 border-[#3b2716] bg-white px-2 py-1 font-mono text-[12px] outline-none"
                />
              ) : (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[#d8c49a] bg-white/60 p-2 font-mono text-[12px]">{d.content}</pre>
              )}
              {d.sendResult && <p className="mt-1 text-[11px]">{d.sendResult}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {d.status === "draft" && (
                  <>
                    <button onClick={() => void decide(d, "approve")} disabled={noAddress} className="village-btn village-btn-go px-2 py-1 text-[11px] disabled:opacity-50">
                      {d.kind === "email" ? "✅ Approve and send" : d.kind === "event" ? "✅ Approve and add" : "✅ Approve"}
                    </button>
                    <button onClick={() => void decide(d, "discard")} className="village-btn village-btn-danger px-2 py-1 text-[11px]">
                      🗑 Discard
                    </button>
                  </>
                )}
                {d.status === "failed" && (
                  <>
                    <button onClick={() => void decide(d, "retry")} className="village-btn px-2 py-1 text-[11px]">
                      ↩ Fix it and try again
                    </button>
                    <button onClick={() => void decide(d, "discard")} className="village-btn village-btn-danger px-2 py-1 text-[11px]">
                      🗑 Discard
                    </button>
                  </>
                )}
                {(d.status === "approved" || d.status === "draft") && (
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText([d.subject, text].filter(Boolean).join("\n\n"));
                        setCopied(d.id);
                      } catch {
                        setError("Couldn't copy; select the text instead.");
                      }
                    }}
                    className="village-btn px-2 py-1 text-[11px]"
                  >
                    {copied === d.id ? "Copied" : "📋 Copy"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || showDone) && (
        <button onClick={() => setShowDone((v) => !v)} className="mt-2 text-[11px] underline">
          {showDone ? "Hide sent and discarded" : `Show sent and discarded (${hidden})`}
        </button>
      )}
    </ParchmentDialog>
  );
}
