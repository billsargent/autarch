import { sqlite } from "@/db";
import { GOOD_LABEL } from "./trades";
import type { ToolContext } from "./tools";

// The village calendar (#173): what's coming up, shared by everyone. Real
// dates and times (the owner's clock, not the village's own), so it lines up
// with the owner's own calendar and Google.
// - Stored events: added by the Mayor (add_event), by the owner, or by an
//   adopted idea that had a date. A meeting on the calendar is held by itself
//   when its time comes (calendarTick).
// - Derived ones, never stored: the weekly market day (a setting) and the
//   deliveries due on accepted orders.
// Every villager sees the next week in THE VILLAGE TODAY and can read further
// with village_calendar. The owner can copy stored events to a Google
// calendar (syncToGoogle, one way).

export const EVENT_KINDS = {
  market: { label: "Market day", icon: "🧺" },
  meeting: { label: "Meeting", icon: "🗣️" },
  vote: { label: "Vote", icon: "🗳️" },
  festival: { label: "Festival", icon: "🎉" },
  delivery: { label: "Delivery", icon: "📦" },
  workday: { label: "Work day", icon: "🔨" },
  other: { label: "Event", icon: "📅" },
} as const;
export type EventKind = keyof typeof EVENT_KINDS;
export const isEventKind = (k: unknown): k is EventKind => typeof k === "string" && k in EVENT_KINDS;
// Kinds anyone may put on the calendar; markets and deliveries come by themselves.
export const ADDABLE_KINDS: EventKind[] = ["meeting", "vote", "festival", "workday", "other"];

export const MAYOR_EVENTS_PER_DAY = 5;
const MAX_UPCOMING = 200;
const DAY = 86_400_000;

export interface VillageEvent {
  id: number | null; // null: a derived event (market day, delivery)
  title: string;
  kind: EventKind;
  startsAt: number; // ms
  endsAt: number | null;
  allDay: boolean;
  place: string | null;
  notes: string | null;
  source: "mayor" | "owner" | "idea" | "market" | "order";
  sourceId: number | null;
  createdBy: number | null;
  synced: boolean;
}

export class CalendarError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function ensureCalendarTables() {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS village_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    starts_at INTEGER NOT NULL,
    ends_at INTEGER,
    all_day INTEGER NOT NULL DEFAULT 0,
    place TEXT,
    notes TEXT,
    source TEXT NOT NULL,
    source_id INTEGER,
    created_by INTEGER,
    started INTEGER NOT NULL DEFAULT 0,
    cancelled INTEGER NOT NULL DEFAULT 0,
    google_id TEXT,
    google_gone INTEGER NOT NULL DEFAULT 0,
    sync_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec("CREATE INDEX IF NOT EXISTS village_events_start ON village_events (starts_at)");
}

// --- when ---------------------------------------------------------------------------------

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// "2026-11-02", "2026-11-02 10:00" (or with a T), "today", "tomorrow", with an
// optional "HH:MM" after the day words. Local time. A day alone is all day.
export function parseWhen(input: string, now = new Date()): { at: Date; allDay: boolean } | null {
  const s = input.trim().toLowerCase();
  let day: Date | null = null;
  let rest = "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](.*))?$/.exec(s);
  if (iso) {
    day = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (day.getMonth() !== Number(iso[2]) - 1 || day.getDate() !== Number(iso[3])) return null;
    rest = iso[4] ?? "";
  } else {
    const word = /^(today|tomorrow)(?:\s+(?:at\s+)?(.*))?$/.exec(s);
    if (!word) return null;
    day = midnight(now);
    if (word[1] === "tomorrow") day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    rest = word[2] ?? "";
  }
  rest = rest.trim().replace(/(:\d{2})(:\d{2})?(\.\d+)?(z|[+-]\d{2}:?\d{2})?$/, "$1");
  if (!rest) return { at: day, allDay: true };
  const t = /^(\d{1,2}):(\d{2})$/.exec(rest);
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  return { at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(t[1]), Number(t[2])), allDay: false };
}

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const describeWhen = (e: Pick<VillageEvent, "startsAt" | "allDay">) => `${fmtDay(new Date(e.startsAt))}${e.allDay ? "" : ` ${fmtTime(new Date(e.startsAt))}`}`;

// --- stored events --------------------------------------------------------------------------

const COLS =
  "id, title, kind, starts_at AS startsAt, ends_at AS endsAt, all_day AS allDay, place, notes, source, source_id AS sourceId, created_by AS createdBy, google_id AS googleId";
type Row = Omit<VillageEvent, "allDay" | "synced" | "startsAt" | "endsAt"> & { startsAt: number; endsAt: number | null; allDay: number; googleId: string | null };
const fromRow = (r: Row): VillageEvent => ({
  ...r,
  kind: isEventKind(r.kind) ? r.kind : "other",
  startsAt: r.startsAt * 1000,
  endsAt: r.endsAt != null ? r.endsAt * 1000 : null,
  allDay: Boolean(r.allDay),
  synced: Boolean(r.googleId),
});

export function getEvent(id: number): VillageEvent | null {
  ensureCalendarTables();
  const r = sqlite.prepare(`SELECT ${COLS} FROM village_events WHERE id = ? AND cancelled = 0`).get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function addEvent(
  input: { title?: unknown; kind?: unknown; when?: unknown; end?: unknown; place?: unknown; notes?: unknown },
  by: { source: VillageEvent["source"]; sourceId?: number | null; createdBy?: number | null },
  now = new Date(),
): VillageEvent {
  ensureCalendarTables();
  const title = String(input.title ?? "").trim().slice(0, 120);
  if (!title) throw new CalendarError("give the event a title.");
  const kind: EventKind = input.kind == null || input.kind === "" ? "other" : isEventKind(input.kind) ? input.kind : ("bad" as EventKind);
  if (!ADDABLE_KINDS.includes(kind)) throw new CalendarError(`the kind is one of: ${ADDABLE_KINDS.join(", ")}.`);
  const when = parseWhen(String(input.when ?? ""), now);
  if (!when) throw new CalendarError('say when as a date, "2026-11-02", or a date and time, "2026-11-02 10:00" (or "tomorrow 10:00").');
  if ((when.allDay ? when.at.getTime() + DAY : when.at.getTime()) <= now.getTime()) throw new CalendarError("that's in the past.");
  if (when.at.getTime() > now.getTime() + 366 * DAY) throw new CalendarError("no more than a year ahead.");
  let endsAt: number | null = null;
  if (input.end != null && String(input.end).trim()) {
    const end = parseWhen(String(input.end), now);
    if (!end) throw new CalendarError('say when it ends the same way, "2026-11-07" or "2026-11-07 16:00".');
    // An all-day event ends on a day (a time given with it is let go); a timed
    // one given only an end day runs to the end of that day.
    const endAt = when.allDay ? midnight(end.at) : end.allDay ? new Date(end.at.getFullYear(), end.at.getMonth(), end.at.getDate(), 23, 59) : end.at;
    if (endAt.getTime() < (when.allDay ? midnight(when.at) : when.at).getTime()) throw new CalendarError("it ends before it starts.");
    endsAt = Math.floor(endAt.getTime() / 1000);
  }
  if (kind === "meeting" && when.allDay) throw new CalendarError("a meeting needs a time, so the village can hold it then.");
  const upcoming = (sqlite.prepare("SELECT COUNT(*) AS n FROM village_events WHERE cancelled = 0 AND starts_at >= ?").get(Math.floor(now.getTime() / 1000)) as { n: number }).n;
  if (upcoming >= MAX_UPCOMING) throw new CalendarError(`the calendar already has ${MAX_UPCOMING} events coming up.`);
  if (by.source === "mayor" && by.createdBy) {
    const today = Math.floor(midnight(now).getTime() / 1000);
    const mine = (sqlite.prepare("SELECT COUNT(*) AS n FROM village_events WHERE created_by = ? AND source = 'mayor' AND created_at >= ?").get(by.createdBy, today) as { n: number }).n;
    if (mine >= MAYOR_EVENTS_PER_DAY) throw new CalendarError(`you've added ${MAYOR_EVENTS_PER_DAY} events today. That's plenty.`);
  }
  const info = sqlite
    .prepare("INSERT INTO village_events (title, kind, starts_at, ends_at, all_day, place, notes, source, source_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      title,
      kind,
      Math.floor(when.at.getTime() / 1000),
      endsAt,
      when.allDay ? 1 : 0,
      String(input.place ?? "").trim().slice(0, 80) || null,
      String(input.notes ?? "").trim().slice(0, 500) || null,
      by.source,
      by.sourceId ?? null,
      by.createdBy ?? null,
    );
  return getEvent(Number(info.lastInsertRowid))!;
}

export function cancelEvent(id: number): void {
  ensureCalendarTables();
  const r = sqlite.prepare("UPDATE village_events SET cancelled = 1 WHERE id = ? AND cancelled = 0").run(id);
  if (!r.changes) throw new CalendarError("there's no such event on the calendar.", 404);
}

// An adopted idea's event comes off with a veto.
export function cancelEventsFrom(source: VillageEvent["source"], sourceId: number): void {
  ensureCalendarTables();
  sqlite.prepare("UPDATE village_events SET cancelled = 1 WHERE source = ? AND source_id = ?").run(source, sourceId);
}

// --- what's coming up -----------------------------------------------------------------------

function marketDay(): number | null {
  const r = sqlite.prepare("SELECT market_day AS d FROM agent_settings LIMIT 1").get() as { d: number | null } | undefined;
  return r?.d ?? null;
}

// Stored and derived events from the start of today, for `days` days, in order.
export function upcoming(days = 14, now = new Date()): VillageEvent[] {
  ensureCalendarTables();
  const from = midnight(now).getTime();
  const to = from + days * DAY;
  const stored = (
    sqlite.prepare(`SELECT ${COLS} FROM village_events WHERE cancelled = 0 AND starts_at >= ? AND starts_at < ? ORDER BY starts_at`).all(Math.floor(from / 1000), Math.floor(to / 1000)) as Row[]
  ).map(fromRow);
  const derived: VillageEvent[] = [];
  const market = marketDay();
  if (market != null) {
    for (let t = from; t < to; t += DAY) {
      const d = new Date(t);
      const day = midnight(d);
      if (day.getDay() === market) derived.push({ id: null, title: "Market day", kind: "market", startsAt: day.getTime(), endsAt: null, allDay: true, place: "the village square", notes: null, source: "market", sourceId: null, createdBy: null, synced: false });
    }
  }
  const orders = sqlite
    .prepare("SELECT id, town, good, qty, due_at * 1000 AS dueAt FROM trade_orders WHERE status = 'accepted' AND due_at >= ? AND due_at < ?")
    .all(Math.floor(from / 1000), Math.floor(to / 1000)) as Array<{ id: number; town: string; good: string; qty: number; dueAt: number }>;
  for (const o of orders) {
    derived.push({
      id: null,
      title: `Delivery due: ${o.qty} ${GOOD_LABEL[o.good as keyof typeof GOOD_LABEL] ?? o.good} to ${o.town}`,
      kind: "delivery",
      startsAt: midnight(new Date(o.dueAt)).getTime(),
      endsAt: null,
      allDay: true,
      place: null,
      notes: null,
      source: "order",
      sourceId: o.id,
      createdBy: null,
      synced: false,
    });
  }
  // All-day things first on their day, then by time.
  return [...stored, ...derived].sort((a, b) => a.startsAt - b.startsAt || Number(b.allDay) - Number(a.allDay));
}

// "Mon 2 Nov 10:00: meeting, who brings in the wheat (the town hall) [#1]";
// the kind is left out when the title already says it.
const line = (e: VillageEvent) => {
  const label = EVENT_KINDS[e.kind].label.toLowerCase();
  const title = e.title.replace(new RegExp(String.raw`^${label}\s*[:\-–—]\s*`, "i"), "");
  const says = e.kind === "market" || e.kind === "delivery" || title.toLowerCase().includes(label) ? e.title : `${label}, ${title}`;
  return `${describeWhen(e)}: ${says}${e.place ? ` (${e.place})` : ""}${e.id ? ` [#${e.id}]` : ""}`;
};

// For THE VILLAGE TODAY: today's date, and the next week.
export function calendarLines(now = new Date()): string[] {
  const week = upcoming(8, now).filter((e) => (e.allDay ? e.startsAt + DAY : e.startsAt) > now.getTime());
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return [
    `- Today is ${today}, ${fmtTime(now)} on the owner's clock (the calendar keeps the owner's dates).`,
    `- Coming up this week: ${week.length ? week.slice(0, 6).map(line).join("; ") + (week.length > 6 ? `; and ${week.length - 6} more (village_calendar)` : "") : "nothing on the calendar"}.`,
  ];
}

// --- tools -----------------------------------------------------------------------------------

type Result = { output: string; summary: string };
const refused = (why: string): Result => ({ output: `Refused: ${why}`, summary: "calendar refused" });

export async function villageCalendarTool(args: Record<string, unknown>): Promise<Result> {
  const days = Math.min(Math.max(Math.floor(Number(args.days) || 14), 1), 60);
  const list = upcoming(days).filter((e) => (e.allDay ? e.startsAt + DAY : e.startsAt) > Date.now());
  if (!list.length) return { output: `Nothing on the village calendar in the next ${days} days.`, summary: "calendar: empty" };
  return {
    output: `The village calendar, the next ${days} days:\n${list.map((e) => `- ${line(e)}${e.notes ? ` — ${e.notes}` : ""}`).join("\n")}`,
    summary: `calendar: ${list.length} events`,
  };
}

export async function addEventTool(args: Record<string, unknown>, ctx?: ToolContext): Promise<Result> {
  try {
    const e = addEvent(args, { source: "mayor", createdBy: ctx?.agentId ?? null });
    return {
      output: `On the calendar as #${e.id}: ${line(e)}.${e.kind === "meeting" ? " The village will meet then by itself." : ""} Everyone sees it in the week ahead.`,
      summary: `event #${e.id}`,
    };
  } catch (err) {
    if (err instanceof CalendarError) return refused(err.message);
    throw err;
  }
}

export async function cancelEventTool(args: Record<string, unknown>): Promise<Result> {
  const id = Number(args.event);
  const e = Number.isInteger(id) ? getEvent(id) : null;
  if (!e) return refused("give the number of an event on the calendar (`event`).");
  if (e.source === "idea") return refused("the village voted for that one; only the owner can take it off.");
  cancelEvent(id);
  return { output: `Taken off the calendar: ${e.title}.`, summary: `event #${id} cancelled` };
}

// --- the worker's round ----------------------------------------------------------------------

// A meeting on the calendar is held when its time comes (within two hours;
// one that was missed, say because the app was off, is let go).
export async function calendarTick(now = new Date()): Promise<string | null> {
  ensureCalendarTables();
  const due = sqlite
    .prepare("SELECT id, title, notes, starts_at AS at FROM village_events WHERE kind = 'meeting' AND cancelled = 0 AND started = 0 AND starts_at <= ? ORDER BY starts_at LIMIT 1")
    .get(Math.floor(now.getTime() / 1000)) as { id: number; title: string; notes: string | null; at: number } | undefined;
  if (!due) return null;
  if (now.getTime() - due.at * 1000 > 2 * 3600_000) {
    sqlite.prepare("UPDATE village_events SET started = 1 WHERE id = ?").run(due.id);
    return null;
  }
  const { currentMeeting, mayorCallsMeeting } = await import("./meetings");
  if (await currentMeeting()) return null; // after the one going on
  try {
    // As if the Mayor called it: the owner is told and everyone answers in turn.
    const { ensureMayor } = await import("./agents");
    await mayorCallsMeeting(await ensureMayor(), due.notes ? `${due.title}: ${due.notes}` : due.title);
  } catch {
    return null; // asleep or paused: tried again next round, until it's too late
  }
  sqlite.prepare("UPDATE village_events SET started = 1 WHERE id = ?").run(due.id);
  return due.title;
}

// --- Google, one way ----------------------------------------------------------------------------

// Copies new events to the owner's chosen Google calendar and takes cancelled
// ones off it. A few at a time; a failure is noted on the event and tried
// again next round.
export async function syncToGoogle(now = new Date(), max = 10): Promise<number> {
  ensureCalendarTables();
  const google = await import("./google");
  const c = await google.getCalendarSettings();
  if (!google.googleConnected(c) || !c.villageCalendarId) return 0;
  let done = 0;
  const fresh = sqlite
    .prepare(`SELECT ${COLS} FROM village_events WHERE cancelled = 0 AND google_id IS NULL AND starts_at >= ? ORDER BY id LIMIT ?`)
    .all(Math.floor(now.getTime() / 1000) - 86400, max) as Row[];
  for (const r of fresh) {
    const e = fromRow(r);
    try {
      const id = await google.createEventIn(c.villageCalendarId, {
        title: `${EVENT_KINDS[e.kind].icon} ${e.title}`,
        description: [e.notes, "From the village calendar."].filter(Boolean).join("\n\n"),
        details: {
          start: new Date(e.startsAt).toISOString(),
          end: new Date(e.endsAt ?? (e.allDay ? e.startsAt : e.startsAt + 3600_000)).toISOString(),
          allDay: e.allDay,
          location: e.place,
        },
      });
      sqlite.prepare("UPDATE village_events SET google_id = ?, sync_error = NULL WHERE id = ?").run(id, e.id);
      done++;
    } catch (err) {
      sqlite.prepare("UPDATE village_events SET sync_error = ? WHERE id = ?").run(String(err instanceof Error ? err.message : err).slice(0, 300), e.id);
    }
  }
  const gone = sqlite.prepare("SELECT id, google_id AS g FROM village_events WHERE cancelled = 1 AND google_id IS NOT NULL AND google_gone = 0 LIMIT ?").all(max) as Array<{ id: number; g: string }>;
  for (const r of gone) {
    try {
      await google.deleteEventIn(c.villageCalendarId, r.g);
      sqlite.prepare("UPDATE village_events SET google_gone = 1, sync_error = NULL WHERE id = ?").run(r.id);
      done++;
    } catch (err) {
      sqlite.prepare("UPDATE village_events SET sync_error = ? WHERE id = ?").run(String(err instanceof Error ? err.message : err).slice(0, 300), r.id);
    }
  }
  return done;
}
