import { getSettings } from "./settingsStore";

// The owner's calendar (#108): read-only, from the private ICS address the
// owner pastes in. The server fetches it; the address is a secret, so no
// agent tool can read it (see query_database). Recurring events are expanded
// for daily and weekly rules, the common ones; other rules show their first
// date only.

export interface CalEvent {
  summary: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  location: string | null;
}

// "20261025" (a date) or "20261025T090000[Z]" (a time, UTC with Z, else local).
export function parseIcsDate(value: string): { date: Date; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return { date: new Date(Number(y), Number(mo) - 1, Number(d)), allDay: true };
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  return { date: z ? new Date(Date.UTC(...parts)) : new Date(...parts), allDay: false };
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// The events in an ICS file that fall between `from` and `to`.
export function parseIcs(text: string, from: Date, to: Date): CalEvent[] {
  // Unfold continuation lines (RFC 5545: a line starting with a space or tab).
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: CalEvent[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT" && cur) {
      expand(cur, from, to, out);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i > 0) cur[line.slice(0, i).split(";")[0].toUpperCase()] = line.slice(i + 1);
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

function expand(ev: Record<string, string>, from: Date, to: Date, out: CalEvent[]) {
  const start = ev.DTSTART ? parseIcsDate(ev.DTSTART) : null;
  if (!start || ev.STATUS === "CANCELLED") return;
  const end = ev.DTEND ? parseIcsDate(ev.DTEND)?.date ?? null : null;
  const length = end ? end.getTime() - start.date.getTime() : 0;
  const base = { summary: unescape(ev.SUMMARY ?? "(no title)"), allDay: start.allDay, location: ev.LOCATION ? unescape(ev.LOCATION) : null };
  const push = (s: Date) => {
    if (s.getTime() + Math.max(length, 0) >= from.getTime() && s < to) out.push({ ...base, start: s, end: length ? new Date(s.getTime() + length) : null });
  };
  const rule = Object.fromEntries((ev.RRULE ?? "").split(";").filter(Boolean).map((p) => p.split("=") as [string, string]));
  if (rule.FREQ !== "DAILY" && rule.FREQ !== "WEEKLY") {
    push(start.date);
    return;
  }
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const until = rule.UNTIL ? parseIcsDate(rule.UNTIL)?.date ?? to : to;
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const byDay = rule.BYDAY ? rule.BYDAY.split(",").map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0) : [start.date.getDay()];
  let n = 0;
  // Walk day by day from the first occurrence; cheap for the short windows shown.
  for (let day = new Date(start.date); day <= until && day < to && n < count; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, day.getHours(), day.getMinutes(), day.getSeconds())) {
    const daysIn = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() - new Date(start.date.getFullYear(), start.date.getMonth(), start.date.getDate()).getTime()) / 86400_000);
    const on = rule.FREQ === "DAILY" ? daysIn % interval === 0 : Math.floor(daysIn / 7) % interval === 0 && byDay.includes(day.getDay());
    if (!on) continue;
    n++;
    push(day);
  }
}

let cache: { url: string; at: number; events: CalEvent[] } | null = null;
const CACHE_MS = 10 * 60_000;
const MAX_BYTES = 2_000_000;

export async function upcomingEvents(days = 14, now = new Date()): Promise<{ configured: boolean; events: CalEvent[]; error?: string }> {
  const url = (await getSettings()).calendarIcsUrl;
  if (!url) return { configured: false, events: [] };
  const to = new Date(now.getTime() + days * 86400_000);
  if (cache && cache.url === url && Date.now() - cache.at < CACHE_MS) return { configured: true, events: cache.events.filter((e) => e.start < to) };
  try {
    const res = await fetch(url.replace(/^webcal:/i, "https:"), { signal: AbortSignal.timeout(10_000), redirect: "follow" });
    if (!res.ok) throw new Error(`the calendar answered ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("the calendar is too big to read");
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("that address isn't an ICS calendar");
    const events = parseIcs(text, new Date(now.getTime() - 86400_000), new Date(now.getTime() + 60 * 86400_000));
    cache = { url, at: Date.now(), events };
    return { configured: true, events: events.filter((e) => e.start < to && (e.end ?? e.start) >= now) };
  } catch (err) {
    return { configured: true, events: [], error: err instanceof Error ? err.message : String(err) };
  }
}
