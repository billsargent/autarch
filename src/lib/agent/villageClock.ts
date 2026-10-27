// The village's own clock (#150): a village day lasts `dayHours` real hours,
// so whenever the app is running the villagers go through work, evening and
// night, whatever the owner's real time. Or "real": the owner's own clock.
// Plain functions, safe in the browser.

export type VillageClock = "own" | "real";

// A village day runs from VILLAGE_WAKE to VILLAGE_BED on its own clock.
export const VILLAGE_WAKE = "07:00";
export const VILLAGE_BED = "22:00";
export const DEFAULT_DAY_HOURS = 4;

// The village's time now, as a Date whose hours and minutes are village time.
export function villageDate(now: Date, clock: VillageClock, dayHours: number): Date {
  if (clock === "real") return now;
  const dayMs = Math.max(1, dayHours) * 3600_000;
  const minutes = Math.floor(((now.getTime() % dayMs) / dayMs) * 1440);
  const d = new Date(now);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

// The bedtime and wake-up that go with a clock: the village's own, or the owner's.
export function villageHours(clock: VillageClock, bedtime: string, wakeTime: string) {
  return clock === "real" ? { bedtime, wakeTime } : { bedtime: VILLAGE_BED, wakeTime: VILLAGE_WAKE };
}
