// Village life without a database (#129): the daily tick, friendship, the day
// split, trades and levels. Run with: npm run test:life
import { lifeTick, nextWindowFor, socialise, statusFor, type LifeState, type TickInput } from "../src/lib/agent/lifeRules";
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

if (failures > 0) {
  console.error(`\n${failures} life test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll life tests passed.");
