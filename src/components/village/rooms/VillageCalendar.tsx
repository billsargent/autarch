"use client";

import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../../data/useSettings";

// The village calendar (#173). On the wall calendar at home it's the whole
// thing: what's coming up, adding an event, taking one off, the market day.
// On the notice board it's the week ahead (compact).

interface Event {
  id: number | null;
  title: string;
  kind: "market" | "meeting" | "vote" | "festival" | "delivery" | "workday" | "other";
  startsAt: number;
  endsAt: number | null;
  allDay: boolean;
  place: string | null;
  notes: string | null;
  source: "mayor" | "owner" | "idea" | "market" | "order";
  synced: boolean;
}

const ICON: Record<Event["kind"], string> = { market: "🧺", meeting: "🗣️", vote: "🗳️", festival: "🎉", delivery: "📦", workday: "🔨", other: "📅" };
const KINDS = [
  ["festival", "Festival"],
  ["meeting", "Meeting (held by itself then)"],
  ["workday", "Work day"],
  ["vote", "Vote"],
  ["other", "Something else"],
] as const;
const SOURCE: Record<Event["source"], string> = { mayor: "the Mayor", owner: "you", idea: "an idea the village adopted", market: "every week", order: "an order" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const input = "mt-1 block w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 font-normal";
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function useVillageCalendar(days: number) {
  // `at`: when it was fetched, so what's already over can be left out.
  const [data, setData] = useState<{ events: Event[]; copiedTo: string | null; syncProblems: number; at: number } | null>(null);
  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/village-calendar?days=${days}`, { cache: "no-store" }).then((r) => r.json());
      setData({ ...d, at: Date.now() });
    } catch {
      /* keep what we have */
    }
  }, [days]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    const id = setInterval(load, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [load]);
  return { data, load };
}

const ahead = (d: { events: Event[]; at: number } | null) => (d?.events ?? []).filter((e) => (e.allDay ? e.startsAt + 86_400_000 : e.startsAt) > d!.at);

function byDay(events: Event[]): Array<[string, Event[]]> {
  const groups = new Map<string, Event[]>();
  for (const e of events) {
    const k = dayLabel(e.startsAt);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.entries()];
}

function EventLine({ e, onCancel }: { e: Event; onCancel?: () => void }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 px-3 py-1 text-xs">
      <span className="w-14 shrink-0 font-semibold">{e.allDay ? "all day" : time(e.startsAt)}</span>
      <span>
        {ICON[e.kind]} {e.title}
        {e.place && <span className="text-[#6b4a2e]"> · {e.place}</span>}
      </span>
      <span className="ml-auto text-[11px] text-[#6b4a2e]">
        {SOURCE[e.source]}
        {e.synced ? " · on Google" : ""}
      </span>
      {onCancel && (
        <button onClick={onCancel} className="text-[11px] underline" title="Take it off the calendar">
          remove
        </button>
      )}
      {e.notes && <p className="w-full pl-16 text-[11px] text-[#6b4a2e]">{e.notes}</p>}
    </li>
  );
}

// The notice board's week ahead.
export function ComingUp() {
  const { data } = useVillageCalendar(8);
  const events = ahead(data);
  if (!events.length) return null;
  return (
    <section className="mb-3">
      <h3 className="village-pixel mb-1 text-xs">📅 Coming up this week</h3>
      <ul className="divide-y-2 divide-[#e6d6b0] rounded border-2 border-[#c9b27a] bg-[#fffaf0]">
        {events.slice(0, 8).map((e, i) => (
          <li key={`${e.id ?? e.kind}-${e.startsAt}-${i}`} className="flex gap-2 px-3 py-1 text-xs">
            <span className="w-24 shrink-0 font-semibold">{new Date(e.startsAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</span>
            <span>
              {ICON[e.kind]} {e.title}
              {!e.allDay && <span className="text-[#6b4a2e]"> · {time(e.startsAt)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The wall calendar's village page.
export default function VillageCalendar() {
  const { data, load } = useVillageCalendar(42);
  const { settings, save } = useSettings();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", kind: "festival", date: "", time: "", place: "", notes: "" });
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const res = await fetch("/api/village-calendar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: form.title, kind: form.kind, when: form.time ? `${form.date} ${form.time}` : form.date, place: form.place, notes: form.notes }),
    });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    setForm({ title: "", kind: "festival", date: "", time: "", place: "", notes: "" });
    setAdding(false);
    await load();
  }

  async function cancel(e: Event) {
    if (!window.confirm(`Take "${e.title}" off the village calendar?`)) return;
    const res = await fetch("/api/village-calendar", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: e.id, action: "cancel" }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    await load();
  }

  const events = ahead(data);
  return (
    <div className="mb-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">📅 The village calendar</p>
        <button onClick={() => setAdding((a) => !a)} className="village-btn ml-auto px-2 py-0.5 text-[11px]">
          {adding ? "Never mind" : "+ Add an event"}
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-[#6b4a2e]">
        Market days, meetings, festivals, work days and deliveries, for everyone. Every villager sees the week ahead.
        {data?.copiedTo ? ` Copied to "${data.copiedTo}" on Google.` : " You can copy it to a Google calendar at the post office's calendar desk."}
        {data?.syncProblems ? ` ${data.syncProblems} event(s) couldn't be copied yet; it tries again.` : ""}
      </p>
      {adding && (
        <div className="mt-2 space-y-2 rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2">
          <label className="block font-semibold">
            What
            <input name="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. The harvest festival" className={input} />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block font-semibold">
              Kind
              <select name="kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={input}>
                {KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block font-semibold">
              Day
              <input name="date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={input} />
            </label>
            <label className="block font-semibold">
              Time (empty: all day)
              <input name="time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className={input} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block font-semibold">
              Where (optional)
              <input name="place" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="the square" className={input} />
            </label>
            <label className="block font-semibold">
              Notes (optional)
              <input name="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={input} />
            </label>
          </div>
          <button onClick={() => void add()} disabled={!form.title.trim() || !form.date} className="village-btn village-btn-go px-3 py-1 text-xs disabled:opacity-50">
            Put it on the calendar
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-[#b3261e]">{error}</p>}
      {!data && <p className="mt-1">Turning the pages…</p>}
      {data && !events.length && <p className="mt-1 text-[#6b4a2e]">Nothing on the village calendar yet.</p>}
      <div className="mt-1 max-h-72 space-y-1.5 overflow-y-auto">
        {byDay(events).map(([day, list]) => (
          <div key={day}>
            <p className="text-[11px] font-semibold text-[#8a5a2b]">{day}</p>
            <ul className="divide-y-2 divide-[#e6d6b0] rounded border-2 border-[#3b2716] bg-[#fffaf0]">
              {list.map((e, i) => (
                <EventLine key={`${e.id ?? e.kind}-${i}`} e={e} onCancel={e.id ? () => void cancel(e) : undefined} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      {settings && (
        <label className="mt-2 flex items-center gap-2 font-semibold">
          Market day
          <select
            name="marketDay"
            value={settings.marketDay ?? ""}
            onChange={(e) => void save({ marketDay: e.target.value === "" ? null : Number(e.target.value) })}
            className="rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-0.5 font-normal"
          >
            <option value="">None</option>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                Every {d}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
