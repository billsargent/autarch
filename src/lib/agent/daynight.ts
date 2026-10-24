// Day and night by the machine's real local time (#100, docs/town-charter.md
// §8). Pure: safe on the server and in the browser, and easy to test.

export type DayPhase = "dawn" | "day" | "dusk" | "night";

// How long dawn lasts after wake-up, and dusk before bedtime (minutes).
const DAWN_MINUTES = 60;
const DUSK_MINUTES = 90;

// "07:30" → 450 (minutes after midnight), or null if it isn't a time.
export function parseHM(hm: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

// Whether `m` falls in [from, to), going round midnight if `to` < `from`.
function within(m: number, from: number, to: number): boolean {
  return from <= to ? m >= from && m < to : m >= from || m < to;
}

// Night runs from bedtime to wake-up, across midnight if need be. Equal times
// mean there's no night at all.
export function isNight(now: Date, bedtime: string, wake: string): boolean {
  const bed = parseHM(bedtime);
  const up = parseHM(wake);
  if (bed === null || up === null || bed === up) return false;
  return within(minutesOf(now), bed, up);
}

export function dayPhase(now: Date, bedtime: string, wake: string): DayPhase {
  if (isNight(now, bedtime, wake)) return "night";
  const bed = parseHM(bedtime);
  const up = parseHM(wake);
  if (bed === null || up === null || bed === up) return "day";
  const m = minutesOf(now);
  if (within(m, up, (up + DAWN_MINUTES) % 1440)) return "dawn";
  if (within(m, (bed - DUSK_MINUTES + 1440) % 1440, bed)) return "dusk";
  return "day";
}

// The next wake-up after `now` (today's if it's still ahead, else tomorrow's).
export function nextWake(now: Date, wake: string): Date {
  const up = parseHM(wake) ?? 7 * 60;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(up / 60), up % 60, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

// "22:05" for the village clock.
export function clockText(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
