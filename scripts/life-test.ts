// Village life without a database (#129): the daily tick, friendship, the day
// split, trades and levels. Run with: npm run test:life
import { lifeTick, makeOrder, nextWindowFor, readyToWed, romanceStep, socialise, statusFor, type LifeState, type TickInput } from "../src/lib/agent/lifeRules";
import { placeDecor } from "../src/lib/agent/shop";
import { villageDate, villageHours } from "../src/lib/agent/villageClock";
import { freeName, VILLAGE_NAMES } from "../src/lib/agent/villageNames";
import { guessTrade, levelOf, titleOf, tradeOf } from "../src/lib/agent/trades";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`}`);
}

const base: LifeState = { xp: 0, energy: 80, fullness: 80, company: 60, coins: 10, place: "home", activity: "resting", withId: null };
const at = (hour: number, more: Partial<TickInput> = {}): TickInput => ({
  hour,
  asleep: false,
  busy: false,
  trade: "baker",
  workplace: true,
  stock: { wheat: 10, bread: 5, ale: 3 },
  tavern: true,
  friend: { id: 9, name: "Ann" },
  rng: () => 0.9,
  ...more,
});

// --- the tick ---------------------------------------------------------------------------
{
  const r = lifeTick(base, at(10));
  check("by day a baker bakes: wheat in, bread out, experience and a coin", [r.state.place, r.state.activity, r.used, r.produced, r.state.xp, r.state.coins], ["work", "baking", { wheat: 1 }, { bread: 1 }, 2, 11]);
  check("…and gets a little tired and hungry", [r.state.energy, r.state.fullness], [78, 78]);
  check("no wheat, no baking", lifeTick(base, at(10, { stock: { wheat: 0, bread: 5 } })).state.activity, "waiting for wheat");
  const field = lifeTick(base, at(10, { trade: "farmer", workplace: false, rng: () => 0.9 }));
  check("a farmer with no farm yet manages only half", field.produced, {});
  check("a skilled worker makes more", lifeTick({ ...base, xp: 400 }, at(10, { trade: "fisher" })).produced, { fish: 2 });
  check("the hungry eat first (bread before fish)", [lifeTick({ ...base, fullness: 20 }, at(10)).used, lifeTick({ ...base, fullness: 20 }, at(10)).state.fullness], [{ bread: 1 }, 63]);
  check("with nothing in the pantry they go hungry", lifeTick({ ...base, fullness: 20 }, at(10, { stock: {} })).hungry, true);
  check("the worn out rest", lifeTick({ ...base, energy: 20 }, at(10)).state.activity, "having a rest");
  // Hungry with an empty pantry: the village must still be able to feed itself.
  const empty = { stock: {}, trade: "farmer" as const };
  const starving = { ...base, fullness: 0, energy: 60 };
  check("hungry with nothing to eat, a farmer still farms by day", [lifeTick(starving, at(10, empty)).state.activity, lifeTick(starving, at(10, empty)).produced, lifeTick(starving, at(10, empty)).hungry], ["working the fields on an empty stomach", { wheat: 1 }, true]);
  check("…forages after work", [lifeTick(starving, at(19, empty)).state.activity, lifeTick(starving, at(19, empty)).state.fullness], ["foraging for berries", 15]);
  check("…and rests when worn out, hungry or not", lifeTick({ ...starving, energy: 0 }, at(10, empty)).state.activity, "having a rest");
  const evening = lifeTick({ ...base, company: 40 }, at(19));
  check("a lonely evening at the tavern, with an ale", [evening.state.place, evening.state.activity, evening.spent, evening.state.company], ["tavern", "having an ale at the tavern", 1, 51]);
  check("no tavern: they visit a friend", [lifeTick({ ...base, company: 40 }, at(19, { tavern: false })).state.place, lifeTick({ ...base, company: 40 }, at(19, { tavern: false })).state.withId], ["visit", 9]);
  check("at night they sleep and recover", [lifeTick({ ...base, energy: 30 }, at(2, { asleep: true })).state.activity, lifeTick({ ...base, energy: 30 }, at(2, { asleep: true })).state.energy], ["asleep", 36]);
  check("computer work comes first: a busy villager isn't moved", lifeTick(base, at(10, { busy: true })).state.activity, "helping the owner with the computer");
  check("the same inputs, the same day", lifeTick(base, at(19)), lifeTick(base, at(19)));
}

// --- friendship -------------------------------------------------------------------------
{
  const pairs = socialise([
    { id: 1, place: "tavern", withId: null },
    { id: 2, place: "tavern", withId: null },
    { id: 3, place: "work", withId: null },
    { id: 4, place: "visit", withId: 5 },
    { id: 5, place: "home", withId: null },
  ]);
  check("time together at the tavern, and on a visit (even if only one chose it)", pairs, [
    { a: 1, b: 2, by: 2 },
    { a: 4, b: 5, by: 3 },
  ]);
  check("acquaintance, friend, close friend", [statusFor(10), statusFor(30), statusFor(75)], ["acquaintance", "friend", "close friend"]);
}

// --- the day split (#130) ---------------------------------------------------------------
{
  const day = { minutesNow: 11 * 60, workStart: 9 * 60, workEnd: 15 * 60, workShare: 60, workMinutesToday: 0, lifeMinutesToday: 0 };
  check("idle: work first, life in the gaps", [
    nextWindowFor({ ...day, mode: "idle", workDue: true, lifeDue: true }),
    nextWindowFor({ ...day, mode: "idle", workDue: false, lifeDue: true }),
    nextWindowFor({ ...day, mode: "idle", workDue: false, lifeDue: false }),
  ], ["work", "life", null]);
  check("hours: work in work hours, life outside them (jobs wait)", [
    nextWindowFor({ ...day, mode: "hours", workDue: true, lifeDue: true }),
    nextWindowFor({ ...day, mode: "hours", minutesNow: 18 * 60, workDue: true, lifeDue: true }),
    nextWindowFor({ ...day, mode: "hours", minutesNow: 18 * 60, workDue: true, lifeDue: false }),
  ], ["work", "life", null]);
  check("balanced: whichever is behind its share", [
    nextWindowFor({ ...day, mode: "balanced", workDue: true, lifeDue: true, workMinutesToday: 10, lifeMinutesToday: 10 }),
    nextWindowFor({ ...day, mode: "balanced", workDue: true, lifeDue: true, workMinutesToday: 40, lifeMinutesToday: 10 }),
    nextWindowFor({ ...day, mode: "balanced", workDue: false, lifeDue: true, workMinutesToday: 0, lifeMinutesToday: 50 }),
  ], ["work", "life", "life"]);
  check("work hours can run past midnight", nextWindowFor({ ...day, mode: "hours", workStart: 22 * 60, workEnd: 6 * 60, minutesNow: 2 * 60, workDue: true, lifeDue: true }), "work");
}

// --- trades and levels ------------------------------------------------------------------
check("a trade is guessed from the role", ["Head gardener", "Fisherman", "Librarian", "Night watch", "Baker", "Something else"].map((r) => guessTrade(r)), ["gardener", "fisher", "scholar", "watchman", "baker", "helper"]);
check("the Mayor's trade is mayor; a chosen trade wins", [guessTrade("Gardener", true), tradeOf({ trade: "baker", role: "Fisherman" }), tradeOf({ trade: "nonsense", role: "Fisherman" })], ["mayor", "baker", "fisher"]);
check("levels and titles", [levelOf(0), levelOf(20), levelOf(320), levelOf(1000), titleOf("baker", 1), titleOf("baker", 3), titleOf("baker", 9)], [1, 2, 5, 8, "Apprentice baker", "Baker", "Master baker"]);

// --- romance (#134) ---------------------------------------------------------------------
{
  const close = { affinity: 70, romance: 0, status: "close friend" };
  check("close friends both open to it may start courting", romanceStep(close, true, 3, () => 0.1), { romance: 3, status: "close friend", event: "courting" });
  check("…never if either isn't open to it", romanceStep(close, false, 3, () => 0.1), { romance: 0, status: "close friend", event: null });
  check("…nor between mere friends", romanceStep({ ...close, affinity: 40 }, true, 3, () => 0.1).romance, 0);
  check("courting becomes sweethearts", romanceStep({ ...close, romance: 28 }, true, 3, () => 0.1), { romance: 31, status: "sweetheart", event: "sweethearts" });
  check("…and then they'd like to marry (the owner's to bless)", [romanceStep({ affinity: 90, romance: 78, status: "sweetheart" }, true, 3, () => 0.1).event, readyToWed({ affinity: 90, romance: 81, status: "sweetheart" })], ["ready", true]);
  check("partners stay partners", romanceStep({ affinity: 90, romance: 90, status: "partner" }, false, 3, () => 0.9).status, "partner");
}

// --- the shop and cottage decor (#135) ----------------------------------------------------
{
  const evening = lifeTick({ ...base, coins: 30 }, at(19, { wish: { key: "painting", label: "a painting", price: 15 }, rng: () => 0.05 }));
  check("with coins to spare, an evening at the market", [evening.bought, evening.state.coins, evening.state.activity], ["painting", 15, "buying a painting at the market"]);
  check("…not when they can't afford it", lifeTick({ ...base, coins: 12 }, at(19, { wish: { key: "painting", label: "a painting", price: 15 }, rng: () => 0.05 })).bought, null);
  check("decor fills the cottage's slots, newest first when they're full", placeDecor(["plant", "painting", "pie", "pot", "chest", "armchair", "candle", "books"]).map((d) => d.item), ["pot", "chest", "armchair", "candle", "books", "painting"]);
}

// --- orders from other towns (#136) ------------------------------------------------------
{
  const small = makeOrder(0, () => 0);
  const big = makeOrder(10, () => 0);
  check("an order: a town, a good, a quantity, a reward, three days", [small.town, small.good, small.qty, small.reward, small.days], ["Millbrook", "wheat", 4, 10, 3]);
  check("a good name brings bigger, better-paid orders", [big.qty > small.qty, big.reward / big.qty > small.reward / small.qty], [true, true]);
}

// --- the village's own clock (#150) ------------------------------------------------------
{
  const vAt = (realMinutes: number) => villageDate(new Date(Date.UTC(2026, 0, 1) + realMinutes * 60_000), "own", 4);
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  check("a village day of 4 real hours: an hour passes every 10 real minutes", [hm(vAt(0)), hm(vAt(10)), hm(vAt(120)), hm(vAt(240))], ["00:00", "01:00", "12:00", "00:00"]);
  const now = new Date(2026, 0, 1, 23, 30);
  check("…or the computer's own clock", villageDate(now, "real", 4), now);
  check("its own clock wakes at 07:00 and sleeps at 22:00; the real one keeps the owner's hours", [villageHours("own", "23:00", "06:00"), villageHours("real", "23:00", "06:00")], [{ bedtime: "22:00", wakeTime: "07:00" }, { bedtime: "23:00", wakeTime: "06:00" }]);
  const day = Array.from({ length: 24 }, (_, i) => {
    const hour = vAt(i * 10).getHours();
    return lifeTick(base, at(hour, { asleep: hour >= 22 || hour < 7, trade: "farmer" })).state.activity;
  });
  check("…and a village day goes through work, evening and sleep", [day.includes("working the fields"), day.includes("asleep"), day.some((a) => !["working the fields", "asleep"].includes(a))], [true, true, true]);
}

// --- names for newcomers (#151) ----------------------------------------------------------
{
  check("a newcomer gets a free name", freeName(["Ada", "agnes"], () => 0), "Alba");
  check("…and none when every name is taken", freeName(VILLAGE_NAMES), null);
}

if (failures > 0) {
  console.error(`\n${failures} life test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll life tests passed.");
