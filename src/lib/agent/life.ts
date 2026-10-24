import { db, sqlite } from "@/db";
import { lifeEvents, villagerLife } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { isNight } from "./daynight";
import { getSettings } from "./settingsStore";
import { GOODS, TRADES, levelOf, titleOf, tradeOf, type Good } from "./trades";
import { FRIEND_AT, TICK_MINUTES, dayKey, hm, lifeTick, nextWindowFor, socialise, statusFor, type Balance } from "./lifeRules";

export * from "./lifeRules";

// Village life (#129, #132): every villager has a day of their own. The worker
// runs lifeTick every TICK_MINUTES for everyone (no model calls): needs drift,
// each villager picks what to do by the hour and what they need (work their
// trade, eat, rest, the tavern, a friend), trade work makes goods for the
// village and earns experience and coins, and villagers who spend time
// together grow closer. Computer work comes first: a villager in a session
// isn't moved.


// Of the jobs that are due, the ones that may run now (#130). A villager's
// "daydream" job is their life window (#133): at most one a day, within the
// life budget. Jobs held back stay due; a life window already had today is
// moved to tomorrow (`postpone`).
export function chooseWindows<J extends { id: number; agentId: number | null; kind: string }>(
  due: J[],
  settings: { lifeBalance: string; workStart: string; workEnd: string; workShare: number; lifeBudgetUsd: number },
  now = new Date(),
): { run: J[]; postpone: J[] } {
  const today = dayKey(now);
  const startOfDay = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
  const minutes = sqlite.prepare(
    `SELECT COALESCE(SUM(CASE WHEN s.trigger = 'life' THEN COALESCE(s.ended_at, unixepoch()) - s.started_at ELSE 0 END), 0) / 60.0 AS life,
            COALESCE(SUM(CASE WHEN s.trigger IN ('scheduled', 'report') THEN COALESCE(s.ended_at, unixepoch()) - s.started_at ELSE 0 END), 0) / 60.0 AS work,
            COALESCE(SUM(CASE WHEN s.trigger = 'life' THEN s.cost_usd ELSE 0 END), 0) AS lifeCost
     FROM work_sessions s JOIN conversations c ON c.id = s.conversation_id WHERE c.agent_id = ? AND s.started_at >= ?`,
  );
  const run: J[] = [];
  const postpone: J[] = [];
  const decided = new Map<number, "work" | "life" | null>();
  for (const id of new Set(due.map((j) => j.agentId).filter((x): x is number => x != null))) {
    const own = sqlite.prepare("SELECT life_balance AS mode, work_share AS share FROM agents WHERE id = ?").get(id) as { mode: string | null; share: number | null } | undefined;
    const life = sqlite.prepare("SELECT last_life_day AS day FROM villager_life WHERE agent_id = ?").get(id) as { day: string | null } | undefined;
    const m = minutes.get(id, startOfDay) as { life: number; work: number; lifeCost: number };
    const lifeJob = due.find((j) => j.agentId === id && j.kind === "daydream");
    const lifeOk = Boolean(lifeJob) && life?.day !== today && m.lifeCost < settings.lifeBudgetUsd;
    if (lifeJob && !lifeOk) postpone.push(lifeJob);
    decided.set(
      id,
      nextWindowFor({
        mode: ((own?.mode ?? settings.lifeBalance) as Balance) || "idle",
        minutesNow: now.getHours() * 60 + now.getMinutes(),
        workStart: hm(settings.workStart),
        workEnd: hm(settings.workEnd),
        workShare: own?.share ?? settings.workShare,
        workMinutesToday: m.work,
        lifeMinutesToday: m.life,
        workDue: due.some((j) => j.agentId === id && j.kind !== "daydream"),
        lifeDue: lifeOk,
      }),
    );
  }
  for (const j of due) {
    if (j.agentId == null) run.push(j);
    else if (decided.get(j.agentId) === (j.kind === "daydream" ? "life" : "work") && !postpone.includes(j)) run.push(j);
  }
  return { run, postpone };
}


// --- the database side ------------------------------------------------------------

type LifeRow = typeof villagerLife.$inferSelect;

export function ensureLife(agentId: number): LifeRow {
  sqlite.prepare("INSERT OR IGNORE INTO villager_life (agent_id) VALUES (?)").run(agentId);
  return db.select().from(villagerLife).where(eq(villagerLife.agentId, agentId)).get()!;
}

export function logLife(kind: string, agentId: number | null, text: string, otherId: number | null = null) {
  sqlite.prepare("INSERT INTO life_events (kind, agent_id, other_id, text) VALUES (?, ?, ?, ?)").run(kind, agentId, otherId, text);
}

// One step of village life for everyone, at most every TICK_MINUTES.
export async function runLifeTick(now = new Date(), rng: () => number = Math.random, force = false): Promise<boolean> {
  const eco = sqlite.prepare("SELECT * FROM economy WHERE id = 1").get() as Record<string, number | null> | undefined;
  if (!eco) return false;
  const nowSec = Math.floor(now.getTime() / 1000);
  if (!force && eco.last_life_tick && nowSec - eco.last_life_tick < TICK_MINUTES * 60 - 5) return false;
  const settings = await getSettings();
  const villagers = sqlite.prepare("SELECT id, name, role, trade, is_mayor AS isMayor, status FROM agents WHERE status != 'dismissed'").all() as Array<{
    id: number;
    name: string;
    role: string;
    trade: string | null;
    isMayor: number;
    status: string;
  }>;
  const busy = new Set(
    (sqlite.prepare("SELECT DISTINCT c.agent_id AS id FROM work_sessions s JOIN conversations c ON c.id = s.conversation_id WHERE s.status = 'running'").all() as Array<{ id: number | null }>).map((r) => r.id),
  );
  const built = new Set((sqlite.prepare("SELECT DISTINCT kind FROM buildings WHERE status = 'built'").all() as Array<{ kind: string }>).map((r) => r.kind));
  const asleep = isNight(now, settings.bedtime, settings.wakeTime);
  const stock: Partial<Record<Good, number>> = Object.fromEntries(GOODS.map((g) => [g, Number(eco[g] ?? 0)]));
  const names = new Map(villagers.map((v) => [v.id, v.name]));
  const bestFriend = sqlite.prepare(
    `SELECT CASE WHEN a_id = ? THEN b_id ELSE a_id END AS id, affinity FROM relationships WHERE (a_id = ? OR b_id = ?) AND affinity >= ${FRIEND_AT} ORDER BY affinity DESC LIMIT 1`,
  );
  const placed: Array<{ id: number; place: string; withId: number | null }> = [];
  let hungry = 0;

  const write = sqlite.transaction(() => {
    for (const v of villagers) {
      const row = ensureLife(v.id);
      const trade = tradeOf({ trade: v.trade, role: v.role, isMayor: Boolean(v.isMayor) });
      const t = TRADES[trade];
      const f = bestFriend.get(v.id, v.id, v.id) as { id: number } | undefined;
      const before = levelOf(row.xp);
      const r = lifeTick(row, {
        hour: now.getHours(),
        asleep,
        busy: busy.has(v.id),
        trade,
        workplace: !t.building || built.has(t.building),
        stock,
        tavern: built.has("tavern"),
        friend: f && names.has(f.id) ? { id: f.id, name: names.get(f.id)! } : null,
        rng,
      });
      for (const [g, n] of Object.entries(r.used)) stock[g as Good] = Math.max(0, (stock[g as Good] ?? 0) - (n ?? 0));
      for (const [g, n] of Object.entries(r.produced)) stock[g as Good] = Math.min(999, (stock[g as Good] ?? 0) + (n ?? 0));
      if (r.hungry) hungry++;
      const s = r.state;
      sqlite
        .prepare(
          "UPDATE villager_life SET xp = ?, energy = ?, fullness = ?, company = ?, coins = ?, place = ?, activity = ?, with_id = ?, updated_at = unixepoch() WHERE agent_id = ?",
        )
        .run(s.xp, s.energy, s.fullness, s.company, s.coins, s.place, s.activity, s.withId, v.id);
      const after = levelOf(s.xp);
      if (after > before) logLife("level", v.id, `${v.name} is now a ${titleOf(trade, after).toLowerCase()} (level ${after}).`);
      placed.push({ id: v.id, place: s.place, withId: s.withId });
    }
    // Time together.
    const get = sqlite.prepare("SELECT affinity, status FROM relationships WHERE a_id = ? AND b_id = ?");
    const upsert = sqlite.prepare(
      "INSERT INTO relationships (a_id, b_id, affinity, status) VALUES (?, ?, ?, ?) ON CONFLICT(a_id, b_id) DO UPDATE SET affinity = excluded.affinity, status = CASE WHEN relationships.status IN ('sweetheart', 'partner') THEN relationships.status ELSE excluded.status END, updated_at = unixepoch()",
    );
    for (const { a, b, by } of socialise(placed)) {
      const cur = get.get(a, b) as { affinity: number; status: string } | undefined;
      const affinity = Math.min(100, (cur?.affinity ?? 0) + by);
      const status = statusFor(affinity);
      upsert.run(a, b, affinity, status);
      if (status !== (cur?.status ?? "acquaintance") && status !== "acquaintance" && !["sweetheart", "partner"].includes(cur?.status ?? "")) {
        logLife("friend", a, `${names.get(a)} and ${names.get(b)} are ${status === "friend" ? "friends" : "close friends"} now.`, b);
      }
      sqlite.prepare("UPDATE villager_life SET company = MIN(100, company + 4) WHERE agent_id IN (?, ?)").run(a, b);
    }
    sqlite
      .prepare("UPDATE economy SET wheat = ?, bread = ?, fish = ?, flowers = ?, crafts = ?, ale = ?, shortage = shortage + ?, last_life_tick = ? WHERE id = 1")
      .run(stock.wheat ?? 0, stock.bread ?? 0, stock.fish ?? 0, stock.flowers ?? 0, stock.crafts ?? 0, stock.ale ?? 0, hungry, nowSec);
  });
  write();
  return true;
}

// --- what a villager knows about their own life -------------------------------------

const feel = (n: number, words: [string, string, string]) => (n >= 60 ? words[0] : n >= 30 ? words[1] : words[2]);

export function lifeSummary(agentId: number) {
  const a = sqlite.prepare("SELECT name, role, trade, is_mayor AS isMayor FROM agents WHERE id = ?").get(agentId) as
    | { name: string; role: string; trade: string | null; isMayor: number }
    | undefined;
  if (!a) return null;
  const life = ensureLife(agentId);
  const trade = tradeOf({ trade: a.trade, role: a.role, isMayor: Boolean(a.isMayor) });
  const level = levelOf(life.xp);
  const friends = sqlite
    .prepare(
      `SELECT ag.id, ag.name, r.status, r.affinity FROM relationships r JOIN agents ag ON ag.id = CASE WHEN r.a_id = ? THEN r.b_id ELSE r.a_id END
       WHERE (r.a_id = ? OR r.b_id = ?) AND r.status != 'acquaintance' AND ag.status != 'dismissed' ORDER BY r.affinity DESC LIMIT 5`,
    )
    .all(agentId, agentId, agentId) as Array<{ id: number; name: string; status: string; affinity: number }>;
  const recent = db.select().from(lifeEvents).where(eq(lifeEvents.agentId, agentId)).orderBy(desc(lifeEvents.id)).limit(5).all();
  return {
    trade,
    tradeLabel: TRADES[trade].label,
    icon: TRADES[trade].icon,
    title: titleOf(trade, level),
    level,
    xp: life.xp,
    energy: life.energy,
    fullness: life.fullness,
    company: life.company,
    coins: life.coins,
    place: life.place,
    activity: life.activity,
    withId: life.withId,
    mood: [feel(life.energy, ["rested", "a bit tired", "worn out"]), feel(life.fullness, ["well fed", "peckish", "hungry"]), feel(life.company, ["in good company", "could use a chat", "lonely"])],
    friends,
    recent: recent.map((e) => e.text),
  };
}

// For the system prompt: the villager's own life, in a few lines.
export function lifeBlock(agentId: number): string {
  const s = lifeSummary(agentId);
  if (!s) return "";
  return [
    "YOUR LIFE IN THE VILLAGE",
    `- You're ${/^[aeiou]/i.test(s.title) ? "an" : "a"} ${s.title.toLowerCase()} (level ${s.level}). Right now you're ${s.activity}.`,
    `- You feel ${s.mood.join(", ")}. You have ${s.coins} coins.`,
    s.friends.length ? `- Friends: ${s.friends.map((f) => `${f.name} (${f.status})`).join(", ")}.` : "- You haven't made close friends yet.",
    s.recent.length ? `- Lately: ${s.recent.slice(0, 3).join(" ")}` : "",
    "- This is your life; talk about it the way a neighbour would.",
  ]
    .filter(Boolean)
    .join("\n");
}
