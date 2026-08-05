// Minimal standard 5-field cron parser + next-run computation.
// Fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, 0=Sunday)
// Supports: *  */n  a-b  a,b  a-b/n

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "") continue;
    let step = 1;
    let range = part;
    if (part.includes("/")) {
      const [r, s] = part.split("/");
      range = r;
      step = Number(s) || 1;
    }
    let lo = min;
    let hi = max;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = hi = Number(range);
    }
    for (let i = lo; i <= hi; i += step) {
      if (i >= min && i <= max) out.add(i);
    }
  }
  return out;
}

export function parseCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  try {
    return {
      minute: parseField(parts[0], 0, 59),
      hour: parseField(parts[1], 0, 23),
      dom: parseField(parts[2], 1, 31),
      month: parseField(parts[3], 1, 12),
      dow: parseField(parts[4], 0, 6),
    };
  } catch {
    return null;
  }
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
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
