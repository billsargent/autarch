// Minimal standard 5-field cron parser + next-run computation.
// Fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-7, 0 and 7 = Sunday)
// Supports: *  */n  a-b  a,b  a-b/n

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 }, // 7 is Sunday too
] as const;

const PART = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/;

class CronError extends Error {}

// One field ("*/15", "1-5", "0,30"). Throws CronError saying what's wrong
// rather than quietly skipping parts it can't read (#24).
function parseField(field: string, spec: (typeof FIELDS)[number]): Set<number> {
  const { name, min, max } = spec;
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = PART.exec(part);
    if (!m) throw new CronError(`the ${name} field has "${part}", which isn't a number, a range, * or a step`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new CronError(`the ${name} field has a step of 0`);
    let lo: number = min;
    let hi: number = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b ?? (m[2] === undefined ? a : max);
      if (lo < min || hi > max) throw new CronError(`the ${name} field must be between ${min} and ${max}, got "${part}"`);
      if (lo > hi) throw new CronError(`the ${name} field has a backwards range "${part}"`);
    }
    for (let i = lo; i <= hi; i += step) out.add(name === "day of week" && i === 7 ? 0 : i);
  }
  return out;
}

function parseOrThrow(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    throw new CronError(`it needs 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`);
  }
  const [minute, hour, dom, month, dow] = parts.map((f, i) => parseField(f, FIELDS[i]));
  return { minute, hour, dom, month, dow };
}

export function parseCron(expr: string): CronFields | null {
  try {
    return parseOrThrow(expr);
  } catch {
    return null;
  }
}

// What's wrong with a cron expression, in words, or null if it's fine.
export function cronProblem(expr: string): string | null {
  try {
    parseOrThrow(expr);
  } catch (err) {
    return err instanceof CronError ? err.message : String(err);
  }
  // e.g. "0 0 31 2 *": every part is valid but February 31st never comes.
  return nextCronRun(expr, new Date()) ? null : "it never comes round (no matching date in the next six years)";
}

export function isValidCron(expr: string): boolean {
  return cronProblem(expr) === null;
}

// Standard cron day semantics: if BOTH dom and dow are restricted (non-*),
// a match on EITHER field counts; if one is *, only the other matters.
export function nextCronRun(expr: string, after: Date): Date | null {
  const c = parseCron(expr);
  if (!c) return null;
  const domRestricted = c.dom.size !== 31;
  const dowRestricted = c.dow.size !== 7;

  let d = new Date(after.getTime() + 60_000);
  d.setSeconds(0, 0);

  for (let i = 0; i < 366 * 6; i++) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    if (!c.month.has(month)) {
      d = new Date(year, d.getMonth() + 1, 1, 0, 0, 0, 0);
      continue;
    }
    const dom = d.getDate();
    const dow = d.getDay();
    const domMatch = c.dom.has(dom);
    const dowMatch = c.dow.has(dow);
    const dayMatch =
      !domRestricted && !dowRestricted
        ? true
        : domRestricted && dowRestricted
          ? domMatch || dowMatch
          : domRestricted
            ? domMatch
            : dowMatch;
    if (!dayMatch) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1);
      d.setMinutes(0, 0, 0);
      continue;
    }
    if (!c.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1);
      d.setSeconds(0, 0);
      continue;
    }
    return d;
  }
  return null;
}
