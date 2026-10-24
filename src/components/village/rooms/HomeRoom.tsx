"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRow } from "@/lib/agent/clientTypes";
import { useApprovals } from "../../data/useApprovals";
import { useHires } from "../../data/useHires";
import { jobSchedule, useJobs } from "../../data/useJobs";
import { useNotifications } from "../../data/useNotifications";
import { useSettings } from "../../data/useSettings";
import { loadPercent, useSystemStatus } from "../../data/useSystemStatus";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";
import TalkDrawer from "../TalkDrawer";
import VillagerPortrait from "../VillagerPortrait";
import { MapTable, Pantry } from "./BuildingDialogs";
import CottageRoom from "./CottageRoom";
import Outbox, { useDrafts } from "./Outbox";
import { useGoals } from "../../data/useGoals";
import MailboxDialog from "./MailboxDialog";
import TownHallRoom from "./TownHallRoom";
import type { RoomProps } from "./types";

// The owner's home (#110): the computer (the Command Center and the
// machine's vital signs), the desk (approvals, hire requests, letters), the
// bookshelves (the villagers' diaries), the wall calendar (what's coming up),
// the armchair (invite a villager over) and the guitar.

export default function HomeRoom({ action, onClose }: RoomProps) {
  switch (action) {
    case "home.computer":
      return <Computer onClose={onClose} />;
    case "home.desk":
      return <Desk onClose={onClose} />;
    case "home.books":
      return <Bookshelves onClose={onClose} />;
    case "home.calendar":
      return <Calendar onClose={onClose} />;
    case "home.invite":
      return <Invite onClose={onClose} />;
    case "home.map":
      return <MapTable onClose={onClose} />;
    case "home.pantry":
      return <Pantry onClose={onClose} />;
    case "home.keepsakes":
      return <Keepsakes onClose={onClose} />;
    default:
      return <Guitar onClose={onClose} />;
  }
}

// --- the computer ---------------------------------------------------------------------

function Computer({ onClose }: { onClose: () => void }) {
  const { status } = useSystemStatus(true);
  const go = [
    { href: "/chat", label: "🖥 Command Center", note: "the classic pages" },
    { href: "/village/observatory?open=monitor.charts", label: "📈 System monitor", note: "CPU, memory, disk and processes" },
    { href: "/village/guardtower?open=activity.log", label: "📜 Activity log", note: "everything the villagers did" },
    { href: "/village/vault?open=usage.ledger", label: "💰 Spending", note: "what the model calls cost" },
  ];
  return (
    <ParchmentDialog kicker="Your home" title="Your computer" onClose={onClose} wide>
      <pre className="rounded border-2 border-[#3b2716] bg-[#1b243e] p-3 font-mono text-[12px] leading-relaxed text-[#6edc8c]">
        {status
          ? [
              `$ uptime        ${status.uptimePretty}`,
              `$ load          ${Math.round(loadPercent(status))}% of ${status.cpuCount} cores`,
              `$ memory        ${status.usedMemPercent}% used of ${Math.round(status.totalMemMB / 1024)} GB`,
              `$ disk          ${diskLine(status.disk)}`,
            ].join("\n")
          : "$ booting…"}
      </pre>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {go.map((g) => (
          <li key={g.href}>
            <Link href={g.href} className="village-btn block px-3 py-2 text-xs">
              {g.label}
              <span className="block text-[11px] font-normal opacity-80">{g.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </ParchmentDialog>
  );
}

// "175G free of 464G (63% used)", from df's line for the root filesystem (or
// its first line, where there's no "/").
function diskLine(df: string): string {
  const rows = df
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c.length >= 6);
  const root = rows.find((c) => c[c.length - 1] === "/") ?? rows[0];
  return root ? `${root[3]} free of ${root[1]} (${root[4]} used)` : "—";
}

// --- the desk ------------------------------------------------------------------------

function Desk({ onClose }: { onClose: () => void }) {
  const { pending } = useApprovals();
  const { waiting } = useHires();
  const { unread } = useNotifications();
  const { waiting: drafts } = useDrafts();
  const [open, setOpen] = useState<"approvals" | "hires" | "letters" | "outbox" | null>(null);
  const { villagers } = useVillagers(30000);
  if (open === "approvals") return <TownHallRoom action="approvals.pending" onClose={onClose} />;
  if (open === "hires") return <TownHallRoom action="hires.open" onClose={onClose} />;
  if (open === "letters") return <MailboxDialog onClose={onClose} />;
  if (open === "outbox") return <Outbox onClose={onClose} />;
  const papers = [
    { id: "approvals" as const, label: "✋ Approvals", count: pending.length, note: "actions waiting for your yes or no" },
    { id: "hires" as const, label: "📜 Hire requests", count: waiting.length, note: "new villagers, with the Mayor's interview" },
    { id: "letters" as const, label: "✉ Letters", count: unread.length, note: "what the villagers wrote to you" },
    { id: "outbox" as const, label: "📤 Outbox", count: drafts.length, note: "drafts for the outside world, waiting for your okay" },
  ];
  return (
    <ParchmentDialog kicker="Your home" title="Your desk" onClose={onClose}>
      <AwayPanel nameOf={(id) => villagers.find((v) => v.id === id)?.name ?? "A villager"} />
      <p className="mb-3 text-xs text-[#6b4a2e]">The papers waiting on you.</p>
      <ul className="space-y-2">
        {papers.map((p) => (
          <li key={p.id}>
            <button onClick={() => setOpen(p.id)} className={`village-btn w-full px-3 py-2 text-left text-xs ${p.count ? "village-btn-go" : ""}`}>
              {p.label}
              {p.count > 0 ? ` (${p.count})` : ""}
              <span className="block text-[11px] font-normal opacity-80">{p.count ? p.note : "nothing waiting"}</span>
            </button>
          </li>
        ))}
      </ul>
    </ParchmentDialog>
  );
}

// --- going away (#102) ---------------------------------------------------------------------

interface AwayState {
  away: boolean;
  until: string | null;
  since: string | null;
  spent: number;
  cap: number;
  decisions: Array<{ id: number; tool: string; status: string; riskLevel: string; agentId: number | null; resolvedAt: number }>;
}

// Tomorrow evening, as a datetime-local value.
function defaultReturn(): string {
  const d = new Date(Date.now() + 2 * 86400_000);
  d.setHours(18, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function AwayPanel({ nameOf }: { nameOf: (id: number | null) => string }) {
  const [state, setState] = useState<AwayState | null>(null);
  const [until, setUntil] = useState(defaultReturn);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await fetch("/api/away").then((r) => r.json()));
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  async function save(patch: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) setError(((await res.json().catch(() => ({}))).error as string | undefined)?.replace(/^\w+: /, "") ?? `HTTP ${res.status}`);
    await reload();
  }

  if (!state) return null;
  const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="mb-3 rounded border-2 border-[#d8c49a] p-3 text-xs">
      {state.away ? (
        <>
          <p className="font-semibold">🧳 You&apos;re away until {when(state.until!)}</p>
          <p className="mt-0.5 text-[#6b4a2e]">
            The Mayor may approve low- and medium-risk requests until the village has spent ${state.cap.toFixed(2)} (spent ${state.spent.toFixed(3)} so far). Anything riskier waits for you.
          </p>
          <button onClick={() => void save({ awayUntil: null })} className="village-btn village-btn-go mt-2 px-3 py-1.5 text-xs">
            🏡 I&apos;m back
          </button>
        </>
      ) : (
        <>
          <p className="font-semibold">Going away?</p>
          <p className="mt-0.5 text-[#6b4a2e]">The Mayor will look after the small requests while you&apos;re gone. High-risk ones always wait for you.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block font-semibold">
              Back by
              <input type="datetime-local" name="awayUntil" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1 block rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 font-normal" />
            </label>
            <button onClick={() => void save({ awayUntil: new Date(until).toISOString() })} className="village-btn px-3 py-1.5 text-xs">
              🧳 I&apos;m going away
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-1 text-[#b3261e]">{error}</p>}
      {state.decisions.length > 0 && (
        <div className="mt-2">
          <p className="font-semibold">{state.away ? "The Mayor has approved" : "While you were away, the Mayor approved"}</p>
          <ul className="mt-1 space-y-0.5">
            {state.decisions.slice(0, 8).map((d) => (
              <li key={d.id}>
                {nameOf(d.agentId)}: <span className="font-mono">{d.tool}</span> ({d.riskLevel} risk) — {d.status === "error" ? "it failed" : "it ran"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- choosing a villager -----------------------------------------------------------------

function ChooseVillager({ title, intro, verb, onPick, onClose }: { title: string; intro: string; verb: (v: AgentRow) => string; onPick: (v: AgentRow) => void; onClose: () => void }) {
  const { villagers, loaded } = useVillagers(15000);
  return (
    <ParchmentDialog kicker="Your home" title={title} onClose={onClose}>
      <p className="mb-3 text-xs text-[#6b4a2e]">{intro}</p>
      {!loaded && <p className="text-sm">Looking around…</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {villagers.map((v) => (
          <li key={v.id}>
            <button onClick={() => onPick(v)} className="village-btn flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs">
              <VillagerPortrait character={v.character} color={v.color} size={28} />
              <span>
                {verb(v)}
                <span className="block text-[11px] font-normal opacity-80">{v.isMayor ? "Mayor" : v.role}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ParchmentDialog>
  );
}

function Bookshelves({ onClose }: { onClose: () => void }) {
  const [reading, setReading] = useState<AgentRow | null>(null);
  if (reading) return <CottageRoom action="journal.open" agentId={reading.id} onClose={onClose} />;
  return (
    <ChooseVillager
      title="Bookshelves"
      intro="Every villager keeps a diary, and you can read any of them."
      verb={(v) => `📔 ${v.name}'s diary`}
      onPick={setReading}
      onClose={onClose}
    />
  );
}

function Invite({ onClose }: { onClose: () => void }) {
  const [guest, setGuest] = useState<AgentRow | null>(null);
  if (guest) return <TalkDrawer villager={guest} onClose={onClose} />;
  return (
    <ChooseVillager
      title="Invite someone over"
      intro="Sit by the fire and talk with any villager."
      verb={(v) => `Invite ${v.name}`}
      onPick={setGuest}
      onClose={onClose}
    />
  );
}

// --- the calendar --------------------------------------------------------------------------

function Calendar({ onClose }: { onClose: () => void }) {
  const { jobs, loaded } = useJobs();
  const { settings } = useSettings();
  const { villagers } = useVillagers(30000);
  const upcoming = jobs
    .filter((j) => j.enabled)
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))
    .slice(0, 10);
  const who = (id: number | null) => villagers.find((v) => v.id === id)?.name ?? "the Mayor";
  const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <ParchmentDialog kicker="Your home" title="The calendar" onClose={onClose}>
      {settings && (
        <p className="mb-3 text-xs text-[#6b4a2e]">
          The village sleeps at <strong>{settings.bedtime}</strong> and wakes at <strong>{settings.wakeTime}</strong>. Work that
          falls due at night waits until morning.
        </p>
      )}
      <YourCalendar connected={Boolean(settings?.calendarSet)} />
      <VillageHappenings />
      <p className="text-xs font-semibold">The village&apos;s jobs</p>
      {!loaded && <p className="text-sm">Turning the pages…</p>}
      {loaded && upcoming.length === 0 && <p className="text-sm">Nothing on the calendar.</p>}
      <ul className="mt-1 divide-y-2 divide-[#e6d6b0] rounded border-2 border-[#3b2716] bg-[#fffaf0]">
        {upcoming.map((j) => (
          <li key={j.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 text-xs">
            <span className="font-semibold">{when(j.nextRunAt)}</span>
            <span>{j.name}</span>
            <span className="ml-auto text-[#6b4a2e]">
              {who(j.agentId)} · {jobSchedule(j)}
            </span>
          </li>
        ))}
      </ul>
    </ParchmentDialog>
  );
}

// Your own calendar (#108): read-only, from its private ICS address.
interface CalEvent {
  summary: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
}

function YourCalendar({ connected }: { connected: boolean }) {
  const [state, setState] = useState<{ configured: boolean; events: CalEvent[]; error?: string } | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await fetch("/api/calendar", { cache: "no-store" }).then((r) => r.json()));
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload, connected]);

  async function save(value: string | null) {
    setError(null);
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ calendarIcsUrl: value }) });
    if (!res.ok) setError(((await res.json().catch(() => ({}))).error as string | undefined)?.replace(/^\w+: /, "") ?? `HTTP ${res.status}`);
    else setUrl("");
    await reload();
  }

  const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const time = (e: CalEvent) => (e.allDay ? "all day" : new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  const byDay = new Map<string, CalEvent[]>();
  for (const e of state?.events ?? []) byDay.set(day(e.start), [...(byDay.get(day(e.start)) ?? []), e]);

  return (
    <div className="mb-3 rounded border-2 border-[#d8c49a] p-2.5 text-xs">
      <p className="font-semibold">📅 Your calendar</p>
      {!state && <p>Turning the pages…</p>}
      {state && !state.configured && (
        <>
          <p className="mt-0.5 text-[#6b4a2e]">
            Paste your calendar&apos;s private ICS address (Google, Apple, Outlook and most others have one in their sharing settings).
            It&apos;s read only, and kept from the villagers.
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <input name="calendarIcsUrl" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… .ics" className="flex-1 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1" />
            <button disabled={!url.trim()} onClick={() => void save(url.trim())} className="village-btn px-2 py-1 text-[11px]">
              Connect
            </button>
          </div>
        </>
      )}
      {state?.configured && (
        <>
          {state.error && <p className="mt-0.5 text-[#b3261e]">Couldn&apos;t read it: {state.error}.</p>}
          {!state.error && state.events.length === 0 && <p className="mt-0.5">Nothing in the next two weeks.</p>}
          <ul className="mt-1 space-y-1">
            {[...byDay.entries()].map(([d, events]) => (
              <li key={d}>
                <span className="font-semibold">{d}</span>
                {events.map((e, i) => (
                  <span key={i} className="block pl-3">
                    {time(e)} · {e.summary}
                    {e.location && <span className="text-[#6b4a2e]"> · {e.location}</span>}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <button onClick={() => void save(null)} className="mt-1.5 text-[11px] underline">
            Disconnect
          </button>
        </>
      )}
      {error && <p role="alert" className="mt-1 text-[#b3261e]">{error}</p>}
    </div>
  );
}

// Ideas the village adopted lately (#104): its events and plans.
interface IdeaLite {
  id: number;
  title: string;
  status: string;
  decidedAt: string | null;
  decidedBy: string | null;
  // Decided in the last 30 days (worked out when loaded).
  recent?: boolean;
}

function useIdeas() {
  const [ideas, setIdeas] = useState<IdeaLite[] | null>(null);
  useEffect(() => {
    fetch("/api/ideas", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const since = Date.now() - 30 * 86400_000;
        setIdeas((d.ideas ?? []).map((i: IdeaLite) => ({ ...i, recent: Boolean(i.decidedAt && Date.parse(i.decidedAt) >= since) })));
      })
      .catch(() => setIdeas([]));
  }, []);
  return ideas;
}

function VillageHappenings() {
  const ideas = useIdeas();
  const adopted = (ideas ?? []).filter((i) => i.status === "adopted" && i.recent);
  if (!adopted.length) return null;
  return (
    <div className="mb-3 text-xs">
      <p className="font-semibold">🎉 The village decided</p>
      <ul className="mt-1 space-y-0.5">
        {adopted.slice(0, 6).map((i) => (
          <li key={i.id}>
            {new Date(i.decidedAt!).toLocaleDateString([], { month: "short", day: "numeric" })} · {i.title}
            <span className="text-[#6b4a2e]"> ({i.decidedBy === "owner" ? "you adopted it" : "by vote"})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- the keepsake chest (#110) ---------------------------------------------------------------

function Keepsakes({ onClose }: { onClose: () => void }) {
  const ideas = useIdeas();
  const { goals } = useGoals();
  const { list: drafts } = useDrafts();
  const done = goals.filter((g) => g.status === "done").slice(0, 10);
  const adopted = (ideas ?? []).filter((i) => i.status === "adopted").slice(0, 10);
  const sent = (drafts ?? []).filter((d) => d.status === "sent" || d.status === "approved").slice(0, 10);
  const section = (title: string, items: string[], empty: string) => (
    <div className="mb-3">
      <p className="text-xs font-semibold">{title}</p>
      {items.length ? (
        <ul className="mt-1 space-y-0.5 text-xs">
          {items.map((t, i) => (
            <li key={i}>· {t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[#6b4a2e]">{empty}</p>
      )}
    </div>
  );
  return (
    <ParchmentDialog kicker="Your home" title="The keepsake chest" onClose={onClose}>
      <p className="mb-3 text-xs text-[#6b4a2e]">Things the village has done for you, kept for a rainy day.</p>
      {section("🏁 Goals finished", done.map((g) => g.title), "None finished yet.")}
      {section("💡 Ideas adopted", adopted.map((i) => i.title), "No ideas adopted yet.")}
      {section("📤 Work sent out", sent.map((d) => d.subject || `A ${d.kind}`), "Nothing sent out yet.")}
    </ParchmentDialog>
  );
}

// --- the guitar ----------------------------------------------------------------------------

// Open chords, as MIDI notes from the low string up.
const CHORDS: Record<string, number[]> = {
  G: [43, 47, 50, 55, 59, 67],
  C: [48, 52, 55, 60, 64],
  D: [50, 57, 62, 66],
  Em: [40, 47, 52, 55, 59, 64],
  Am: [45, 52, 57, 60, 64],
};

// A plucked string (Karplus–Strong): a burst of noise through a delay line
// that averages and fades, which rings like a string.
function pluck(ctx: AudioContext, midi: number, when: number) {
  const freq = 440 * 2 ** ((midi - 69) / 12);
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 2.4);
  const buffer = ctx.createBuffer(1, length, rate);
  const out = buffer.getChannelData(0);
  const period = Math.max(2, Math.round(rate / freq));
  const ring = new Float32Array(period).map(() => Math.random() * 2 - 1);
  for (let i = 0, at = 0; i < length; i++) {
    const next = (at + 1) % period;
    out[i] = ring[at];
    ring[at] = 0.4985 * (ring[at] + ring[next]);
    at = next;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.16;
  source.connect(gain).connect(ctx.destination);
  source.start(when);
}

function Guitar({ onClose }: { onClose: () => void }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const [last, setLast] = useState<string | null>(null);
  function strum(name: string) {
    ctxRef.current ??= new AudioContext();
    const ctx = ctxRef.current;
    void ctx.resume();
    CHORDS[name].forEach((note, i) => pluck(ctx, note, ctx.currentTime + i * 0.03));
    setLast(name);
  }
  return (
    <ParchmentDialog kicker="Your home" title="Your guitar" onClose={onClose}>
      <p className="mb-3 text-xs text-[#6b4a2e]">An old acoustic, nicely in tune. Strum a chord.</p>
      <div className="flex flex-wrap gap-2">
        {Object.keys(CHORDS).map((c) => (
          <button key={c} onClick={() => strum(c)} className="village-btn village-pixel px-4 py-2 text-sm">
            {c}
          </button>
        ))}
      </div>
      <p className="mt-3 h-5 text-sm" aria-live="polite">
        {last ? `♪ ${last} ♫` : ""}
      </p>
    </ParchmentDialog>
  );
}
