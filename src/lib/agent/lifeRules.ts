import { stintInputs, TRADES, levelOf, type Good, type TradeKey } from "./trades";
import { scaled, seasonFactor, type Season } from "./seasons";

// The rules of village life (#129), with no database: one villager's ten
// minutes, who grows closer, and the day split. life.ts applies them to the
// village; scripts/life-test.ts tests them.

export const TICK_MINUTES = 10;
// How often a light-fingered villager pockets a loaf, and a lazy one dozes
// through a stint, per ten minutes (#153).
export const STEAL_CHANCE = 0.04;
export const DOZE_CHANCE = 0.25;
// How warmly each trait makes friends.
export const warmthOf = (traits: readonly string[] | null | undefined) => (traits?.includes("cheerful") ? 1.5 : traits?.includes("grumpy") ? 0.5 : 1);

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
  // Something they'd like from the shop, if they can spare the coins (#135).
  wish?: { key: string; label: string; price: number } | null;
  // Their character traits (#153, traits.ts).
  traits?: readonly string[];
  // The season and the day's happenings (#187): a storm slows the fields.
  season?: Season;
  storm?: boolean;
  // Tools in the stores (#188), and a school standing (#189).
  tools?: boolean;
  school?: boolean;
  rng: () => number;
}

export interface TickResult {
  state: LifeState;
  produced: Partial<Record<Good, number>>;
  used: Partial<Record<Good, number>>;
  hungry: boolean;
  spent: number;
  bought: string | null;
  // Trait doings (#153): a loaf pocketed, a stint dozed through, flowers for a friend.
  stole?: boolean;
  skipped?: boolean;
  gaveTo?: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// One villager, ten minutes. Pure: same inputs, same answer.
export function lifeTick(s: LifeState, i: TickInput): TickResult {
  const out: TickResult = { state: { ...s }, produced: {}, used: {}, hungry: false, spent: 0, bought: null };
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
  const has = (t: string) => Boolean(i.traits?.includes(t));
  // Light-fingered (#153): now and then a loaf goes from the stores into a pocket
  // (and is sold on), whatever else they're doing.
  if (has("thieving") && (i.stock.bread ?? 0) > 0 && i.rng() < STEAL_CHANCE) {
    out.used.bread = (out.used.bread ?? 0) + 1;
    out.stole = true;
    st.coins += 2;
  }
  const food: Good | null = (i.stock.bread ?? 0) - (out.used.bread ?? 0) > 0 ? "bread" : (i.stock.fish ?? 0) > 0 ? "fish" : null;

  // Hungry with nothing in the pantry: they still rest when worn out and
  // work their trade by day (or nobody would ever grow the food), and forage
  // a little otherwise. Hunger never stops the village working.
  const hungryNoFood = st.fullness < 35 && !food;
  if (hungryNoFood) out.hungry = true;
  if (st.fullness < 35 && food) {
    out.used[food] = (out.used[food] ?? 0) + 1;
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
    // Lazy (#153): now and then they doze instead.
    if (has("lazy") && i.rng() < DOZE_CHANCE) {
      st.energy = clamp(st.energy + 3);
      out.skipped = true;
      set("home", "dozing when there's work to do");
      return out;
    }
    const t = TRADES[i.trade];
    // Hardworking (#153): they learn their trade faster; so does anyone still
    // learning (below level 5) when there's a school (#189).
    st.xp += (has("hardworking") ? 3 : 2) + (i.school && levelOf(st.xp) < 5 ? 1 : 0);
    st.coins += 1;
    const level = levelOf(st.xp);
    let n = t.goods ? 1 + (level >= 5 ? 1 : 0) + (level >= 8 ? 1 : 0) : 0;
    if (n && t.building && !i.workplace) n = i.rng() < 0.5 ? 1 : 0; // no proper workplace yet: half as much
    // The season (#187), and a storm on the fields that day.
    if (n) n = scaled(n, seasonFactor(t.goods, i.season) * (i.storm && t.goods === "wheat" ? 0.5 : 1), i.rng);
    // Tools (#188): now and then they make a stint go further (not the smith's own).
    if (n && i.tools && i.trade !== "smith" && i.rng() < TOOLS_CHANCE) n += 1;
    if (n && "uses" in t && t.uses) {
      const got = stintInputs(t, n, i.stock, i.rng);
      if (!got.made || !got.used) {
        set("work", `waiting for ${t.uses}${"makesDoWith" in t && t.makesDoWith ? ` or ${t.makesDoWith}` : ""}`);
        return out;
      }
      n = got.made;
      out.used[got.used] = n;
    }
    if (n && t.goods) out.produced[t.goods] = n;
    set("work", hungryNoFood ? `${t.doing} on an empty stomach` : t.doing);
    return out;
  }
  if (hungryNoFood) {
    st.fullness = clamp(st.fullness + 15);
    set("plaza", "foraging for berries");
    return out;
  }
  // Generous (#153): flowers for a friend, now and then.
  if (evening && has("generous") && i.friend && st.coins >= 8 && i.rng() < 0.1) {
    st.coins -= 4;
    out.spent = 4;
    out.gaveTo = i.friend.id;
    st.company = clamp(st.company + 5);
    set("visit", `taking flowers to ${i.friend.name}`, i.friend.id);
    return out;
  }
  // Now and then, coins to spare go on something for the cottage (never for the thrifty, #153).
  if (evening && i.wish && !has("thrifty") && st.coins >= i.wish.price + 5 && i.rng() < 0.15) {
    st.coins -= i.wish.price;
    out.spent = i.wish.price;
    out.bought = i.wish.key;
    st.company = clamp(st.company + 3);
    set("plaza", `buying ${i.wish.label} at the market`);
    return out;
  }
  // Chatty folk go out more of an evening, shy ones less (#153).
  const goOut = has("chatty") ? 0.7 : has("shy") ? 0.15 : 0.4;
  if (evening && (st.company < (has("shy") ? 40 : 60) || i.rng() < goOut)) {
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
// `warmth`: how fast each villager makes friends (cheerful 1.5, grumpy 0.5, #153).
export function socialise(where: Array<{ id: number; place: string; withId: number | null }>, warmth: Map<number, number> = new Map()): Array<{ a: number; b: number; by: number }> {
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
    const base = k.startsWith("visit") ? 3 : k === "tavern" ? 2 : 1;
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const w = ((warmth.get(ids[x]) ?? 1) + (warmth.get(ids[y]) ?? 1)) / 2;
        out.push({ a: Math.min(ids[x], ids[y]), b: Math.max(ids[x], ids[y]), by: Math.max(1, Math.round(base * w)) });
      }
    }
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

// --- romance (#134) --------------------------------------------------------------------
// Only between close friends who are both open to it (the owner's toggle). Time
// together at the tavern or a visit can turn into courting, then sweethearts;
// a wedding is the owner's to bless (`readyToWed`).
export const SWEETHEART_AT = 30;
export const WED_AT = 80;

export interface Bond {
  affinity: number;
  romance: number;
  status: string;
}

export function romanceStep(b: Bond, bothOpen: boolean, by: number, rng: () => number): { romance: number; status: string; event: "courting" | "sweethearts" | "ready" | null } {
  const friendly = statusFor(b.affinity);
  if (b.status === "partner") return { romance: Math.min(100, b.romance + by), status: "partner", event: null };
  if (!bothOpen || b.affinity < CLOSE_AT || rng() >= 0.35) {
    return { romance: b.romance, status: b.status === "sweetheart" ? "sweetheart" : friendly, event: null };
  }
  const romance = Math.min(100, b.romance + by);
  const status = romance >= SWEETHEART_AT ? "sweetheart" : friendly;
  const event = b.romance === 0 ? "courting" : b.romance < SWEETHEART_AT && romance >= SWEETHEART_AT ? "sweethearts" : b.romance < WED_AT && romance >= WED_AT ? "ready" : null;
  return { romance, status, event };
}

export const readyToWed = (b: Bond) => b.status === "sweetheart" && b.romance >= WED_AT;

// --- orders from other towns (#136) ----------------------------------------------------
export const TOWNS = ["Millbrook", "Stonehaven", "Riverbend", "Ashford"];
// What a unit of each good fetches, in coins.
export const GOOD_PRICE: Record<Good, number> = { wheat: 2, flour: 3, bread: 3, fish: 3, flowers: 2, crafts: 5, ale: 3, iron: 3, tools: 6 };
// Flour is only asked for once the village has a mill (#186).
const ORDER_GOODS: Good[] = ["wheat", "bread", "fish", "flowers", "crafts", "ale"];
export const ORDER_DAYS = 3;
// How often tools in the stores add one to a stint (#188).
export const TOOLS_CHANCE = 0.25;

// A new order: bigger and better paid as the village's name grows.
export function makeOrder(reputation: number, rng: () => number, extra: Good[] = []): { town: string; good: Good; qty: number; reward: number; days: number } {
  const choices = [...ORDER_GOODS, ...extra.filter((g) => !ORDER_GOODS.includes(g))];
  const good = choices[Math.floor(rng() * choices.length)];
  const rep = Math.max(0, Math.min(20, reputation));
  const qty = Math.min(40, 4 + Math.floor(rng() * 5) + rep);
  const reward = Math.round(qty * GOOD_PRICE[good] * (1.2 + rep * 0.05));
  return { town: TOWNS[Math.floor(rng() * TOWNS.length)], good, qty, reward, days: ORDER_DAYS };
}
