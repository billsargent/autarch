// Seasons (#187): what grows depends on the time of year. On the village's
// own clock a season is SEASON_DAYS village days, so they turn while the app
// runs; on the owner's clock they follow the months (northern hemisphere).
// Plain functions, safe in the browser.
import type { Good } from "./trades";
import type { VillageClock } from "./villageClock";

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_DAYS = 7;
const DAY_MS = 86_400_000;

// A count of the village's days since the start of time: on its own clock,
// one every `dayHours` real hours; on the owner's, their local calendar days.
export function villageDayNumber(now: Date, clock: VillageClock, dayHours: number): number {
  if (clock === "real") return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / DAY_MS);
  return Math.floor(now.getTime() / (Math.max(1, dayHours) * 3_600_000));
}

// When a village day begins, in real time.
export function villageDayStart(day: number, clock: VillageClock, dayHours: number): Date {
  if (clock === "real") {
    const d = new Date(day * DAY_MS);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  return new Date(day * Math.max(1, dayHours) * 3_600_000);
}

export interface SeasonNow {
  season: Season;
  day: number; // 1 = the season's first day
  dayNumber: number; // villageDayNumber
  // The village day number its season began on.
  startedOn: number;
}

export function seasonOf(now: Date, clock: VillageClock, dayHours: number): SeasonNow {
  const dayNumber = villageDayNumber(now, clock, dayHours);
  if (clock === "real") {
    const m = now.getMonth(); // Mar–May spring … Dec–Feb winter
    const season = SEASONS[Math.floor(((m + 10) % 12) / 3)];
    const first = new Date(now.getFullYear(), m - ((m + 10) % 12) % 3, 1);
    const startedOn = villageDayNumber(first, clock, dayHours);
    return { season, day: dayNumber - startedOn + 1, dayNumber, startedOn };
  }
  const index = Math.floor(dayNumber / SEASON_DAYS);
  return { season: SEASONS[((index % 4) + 4) % 4], day: (dayNumber % SEASON_DAYS) + 1, dayNumber, startedOn: index * SEASON_DAYS };
}

// How much of a good the season gives, as a factor on a stint: winter halves
// what the fields, garden and pond give; autumn's harvest adds half again to
// the wheat; summer adds a little to the flowers.
export function seasonFactor(good: Good | null, season: Season | undefined): number {
  if (!good || !season) return 1;
  if (good === "wheat") return season === "winter" ? 0.5 : season === "autumn" ? 1.5 : 1;
  if (good === "flowers") return season === "winter" ? 0.5 : season === "summer" ? 1.5 : 1;
  if (good === "fish") return season === "winter" ? 0.5 : 1;
  return 1;
}

// A whole number of goods from a stint of `n` at `factor`: the fraction is a
// chance of one more (or, below one, of keeping one at all).
export function scaled(n: number, factor: number, rng: () => number): number {
  if (!n || factor === 1) return n;
  const exact = n * factor;
  const whole = Math.floor(exact);
  return whole + (rng() < exact - whole ? 1 : 0);
}

export const SEASON_NOTE: Record<Season, string> = {
  spring: "spring: sowing time",
  summer: "summer: the garden blooms",
  autumn: "autumn: harvest time, the fields give extra",
  winter: "winter: the fields, garden and pond give half",
};
