import { TRADES, levelOf, type Good, type TradeKey } from "./trades";

// The rules of village life (#129), with no database: one villager's ten
// minutes, who grows closer, and the day split. life.ts applies them to the
// village; scripts/life-test.ts tests them.

export const TICK_MINUTES = 10;

export interface LifeState {
  xp: number;
  energy: number;
  fullness: number;
  company: number;
  coins: number;
  place: string; // "home" | "work" | "tavern" | "plaza" | "visit"
  activity: string;
  withId: number | null;
}

export interface TickInput {
  hour: number; // 0-23, local
  asleep: boolean;
  busy: boolean; // in a computer session
  trade: TradeKey;
  workplace: boolean; // their trade's building stands (or they need none)
  stock: Partial<Record<Good, number>>;
  tavern: boolean;
  friend: { id: number; name: string } | null;
  rng: () => number;
}

export interface TickResult {
  state: LifeState;
  produced: Partial<Record<Good, number>>;
  used: Partial<Record<Good, number>>;
  hungry: boolean;
  spent: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// One villager, ten minutes. Pure: same inputs, same answer.
export function lifeTick(s: LifeState, i: TickInput): TickResult {
  const out: TickResult = { state: { ...s }, produced: {}, used: {}, hungry: false, spent: 0 };
  const st = out.state;
  const set = (place: string, activity: string, withId: number | null = null) => Object.assign(st, { place, activity, withId });
  if (i.busy) {
    st.energy = clamp(st.energy - 1);
    st.fullness = clamp(st.fullness - 1);
    set("work", "helping the owner with the computer");
    return out;
  }
  if (i.asleep) {
    st.energy = clamp(st.energy + 6);
    st.fullness = clamp(st.fullness - 1);
    set("home", "asleep");
    return out;
  }
  st.energy = clamp(st.energy - 2);
  st.fullness = clamp(st.fullness - 2);
  st.company = clamp(st.company - 1);
  const evening = i.hour >= 17 && i.hour < 22;
  const food: Good | null = (i.stock.bread ?? 0) > 0 ? "bread" : (i.stock.fish ?? 0) > 0 ? "fish" : null;

  if (st.fullness < 35) {
    if (!food) {
      out.hungry = true;
      set("plaza", "looking for something to eat");
      return out;
    }
    out.used[food] = 1;
    st.fullness = clamp(st.fullness + 45);
    if (evening && i.tavern && st.coins >= 2) {
      st.coins -= 2;
      out.spent = 2;
      st.company = clamp(st.company + 6);
      set("tavern", "having supper at the tavern");
    } else set("home", food === "fish" ? "having fish for a meal" : "having a meal");
    return out;
  }
  if (st.energy < 25) {
    st.energy = clamp(st.energy + 10);
    set("home", "having a rest");
    return out;
  }
  if (i.hour >= 8 && i.hour < 17) {
    const t = TRADES[i.trade];
    st.xp += 2;
    st.coins += 1;
    const level = levelOf(st.xp);
    let n = t.goods ? 1 + (level >= 5 ? 1 : 0) + (level >= 8 ? 1 : 0) : 0;
    if (n && t.building && !i.workplace) n = i.rng() < 0.5 ? 1 : 0; // no proper workplace yet: half as much
    if (n && "uses" in t && t.uses) {
      n = Math.min(n, i.stock[t.uses] ?? 0);
      if (!n) {
        set("work", `waiting for ${t.uses}`);
        return out;
      }
      out.used[t.uses] = n;
    }
    if (n && t.goods) out.produced[t.goods] = n;
    set("work", t.doing);
    return out;
  }
  if (evening && (st.company < 60 || i.rng() < 0.4)) {
    if (i.tavern) {
      const drink = st.coins >= 1 && (i.stock.ale ?? 0) > 0;
      if (drink) {
        st.coins -= 1;
        out.spent = 1;
        out.used.ale = 1;
      }
      st.company = clamp(st.company + 12);
      set("tavern", drink ? "having an ale at the tavern" : "at the tavern");
      return out;
    }
    if (i.friend) {
      st.company = clamp(st.company + 10);
      set("visit", `visiting ${i.friend.name}`, i.friend.id);
      return out;
    }
    st.company = clamp(st.company + 3);
    set("plaza", "out for a stroll");
    return out;
  }
  st.energy = clamp(st.energy + 2);
  set("home", i.hour < 8 ? "getting ready for the day" : "relaxing at home");
  return out;
}

// Villagers in the same place keep each other company and grow closer.
// Returns the pairs (a < b) and how much closer, by place.
export function socialise(where: Array<{ id: number; place: string; withId: number | null }>): Array<{ a: number; b: number; by: number }> {
  const spot = (w: { id: number; place: string; withId: number | null }) => (w.place === "visit" && w.withId ? `visit:${Math.min(w.id, w.withId)}-${Math.max(w.id, w.withId)}` : w.place);
  const groups = new Map<string, number[]>();
  for (const w of where) {
    if (w.place === "home" || w.place === "work") continue; // apart, mostly
    const k = spot(w);
    groups.set(k, [...(groups.get(k) ?? []), w.id]);
  }
  // A visit is a pair even if only one of them chose it.
  for (const w of where) if (w.place === "visit" && w.withId && !where.some((o) => o.id === w.withId && spot(o) === spot(w))) groups.set(spot(w), [w.id, w.withId]);
  const out: Array<{ a: number; b: number; by: number }> = [];
  for (const [k, ids] of groups) {
    const by = k.startsWith("visit") ? 3 : k === "tavern" ? 2 : 1;
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) out.push({ a: Math.min(ids[x], ids[y]), b: Math.max(ids[x], ids[y]), by });
  }
  return out;
}

// --- the day split (#130) -----------------------------------------------------------
// What a villager's own time goes on next: a computer work window (a due job)
// or a life window. The owner's own requests never come through here: they
// always run.

export type Balance = "idle" | "hours" | "balanced";
export interface SplitInput {
  mode: Balance;
  minutesNow: number; // minutes since midnight, local
  workStart: number; // minutes since midnight
  workEnd: number;
  workShare: number; // 0-100, for "balanced"
  workMinutesToday: number;
  lifeMinutesToday: number;
  workDue: boolean; // a job of theirs is due
  lifeDue: boolean; // village life is on and they haven't had today's window
}

export const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const within = (now: number, start: number, end: number) => (start <= end ? now >= start && now < end : now >= start || now < end);

export function nextWindowFor(i: SplitInput): "work" | "life" | null {
  if (i.mode === "hours") {
    const working = within(i.minutesNow, i.workStart, i.workEnd);
    if (working) return i.workDue ? "work" : null;
    return i.lifeDue ? "life" : null;
  }
  if (i.mode === "balanced" && i.workDue && i.lifeDue) {
    const total = i.workMinutesToday + i.lifeMinutesToday;
    const share = total ? (100 * i.workMinutesToday) / total : i.workShare >= 50 ? 0 : 100;
    return share < i.workShare ? "work" : "life";
  }
  // "idle" (and "balanced" with only one kind due): work first, life in the gaps.
  if (i.workDue) return "work";
  return i.lifeDue ? "life" : null;
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const FRIEND_AT = 30;
export const CLOSE_AT = 60;
export const statusFor = (affinity: number) => (affinity >= CLOSE_AT ? "close friend" : affinity >= FRIEND_AT ? "friend" : "acquaintance");
