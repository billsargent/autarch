"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";
import { Calendar } from "./HomeRoom";
import LetterRack from "./LetterRack";
import Outbox, { useDrafts } from "./Outbox";
import type { RoomProps } from "./types";

// The post office (#144): the counter (drafts waiting for you), the
// pigeonholes (everything sent, who wrote it and why), the mailbag (your
// inbox) and the calendar desk.
export default function PostOfficeRoom({ action, onClose }: RoomProps) {
  if (action === "post.sent") return <SentLog onClose={onClose} />;
  if (action === "post.inbox") return <Mailbag onClose={onClose} />;
  if (action === "post.calendar") return <Calendar onClose={onClose} />;
  if (action === "post.letters") return <LetterRack kicker="The post office" onClose={onClose} />;
  return <Outbox onClose={onClose} kicker="The post office" />;
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function SentLog({ onClose }: { onClose: () => void }) {
  const { list } = useDrafts();
  const { byId } = useVillagers(30000);
  const sent = list?.filter((d) => d.status === "sent" || d.status === "failed") ?? null;
  return (
    <ParchmentDialog kicker="The post office" title="Pigeonholes: everything sent" onClose={onClose} wide>
      <p className="mb-3 text-xs text-[#6b4a2e]">Every email that went out from your account (or tried to): who wrote it, why, and what the mail server said.</p>
      {!sent && <p className="text-sm">Sorting the post…</p>}
      {sent?.length === 0 && <p className="text-sm">Nothing has been sent yet.</p>}
      <ul className="space-y-2">
        {sent?.map((d) => (
          <li key={d.id} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2.5 text-xs">
            <p className="flex flex-wrap gap-2">
              <strong>{d.subject || "(no subject)"}</strong>
              <span className="text-[#6b4a2e]">to {d.target}</span>
              <span className={`ml-auto font-semibold ${d.status === "sent" ? "text-[#3f6b22]" : "text-[#b3261e]"}`}>
                {d.status === "sent" ? `Sent ${when(d.sentAt)}` : "Couldn't be sent"}
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-[#6b4a2e]">
              Written by {byId(d.agentId)?.name ?? "a villager"}
              {d.why ? ` · why: ${d.why}` : ""}
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] underline">The message</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-[#d8c49a] bg-white/60 p-2 font-mono text-[12px]">{d.content}</pre>
            </details>
            {d.sendResult && <p className="mt-1 text-[11px]">{d.sendResult}</p>}
          </li>
        ))}
      </ul>
    </ParchmentDialog>
  );
}

interface MailItem {
  uid: number;
  date: string | null;
  from: string;
  subject: string;
  text: string;
  seen: boolean;
}

function Mailbag({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ total?: number; unseen?: number; items?: MailItem[]; error?: string } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await fetch("/api/email/inbox", { cache: "no-store" }).then((r) => r.json()));
    } catch (err) {
      setData({ error: err instanceof Error ? err.message : String(err) });
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <ParchmentDialog kicker="The post office" title="The mailbag: your inbox" onClose={onClose} wide>
      <p className="mb-3 text-xs text-[#6b4a2e]">
        Your newest mail, read-only (nothing is marked read). Set up your account and choose which villagers may read it in the{" "}
        <Link href="/village/townhall?open=settings.open" className="underline">
          Mayor&apos;s ledger → Email
        </Link>
        .
      </p>
      {!data && <p className="text-sm">Opening the mailbag…</p>}
      {data?.error && <p className="rounded border-2 border-dashed border-[#c9b27a] p-3 text-sm">{data.error}</p>}
      {data?.items && (
        <>
          <p className="mb-2 text-xs">
            {data.total} messages, {data.unseen} unread.
          </p>
          <ul className="space-y-1.5">
            {data.items.map((m) => (
              <li key={m.uid} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2 text-xs">
                <p className="flex flex-wrap gap-2">
                  <strong className={m.seen ? "" : "text-[#8a5a2b]"}>{m.subject}</strong>
                  <span className="text-[#6b4a2e]">{m.from}</span>
                  <span className="ml-auto text-[#6b4a2e]">{m.date ? when(m.date) : ""}</span>
                </p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px]">{m.text.slice(0, 400)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </ParchmentDialog>
  );
}
