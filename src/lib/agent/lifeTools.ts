import type OpenAI from "openai";
import { sqlite } from "@/db";
import { ensureLife, logLife, romanceStep, statusFor } from "./life";
import { SHOP, SHOP_KEYS, isShopKey } from "./shop";
import type { RiskResult } from "./risk";
import type { ToolContext } from "./tools";
import { TRADES, levelOf, stintInputs, titleOf, tradeOf, type Good } from "./trades";

// The life window's tools (#133): the only tools a villager has in their own
// time. Nothing here touches the computer: no shell, files or network. They
// change the villager's life in the village (life.ts), right away.

type Result = { output: string; summary: string };
interface LifeTool {
  definition: OpenAI.Chat.Completions.ChatCompletionTool;
  risk: RiskResult;
  run: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<Result>;
}

const ACTIVITIES = ["work", "eat", "rest", "tavern", "stroll", "home"] as const;
type Activity = (typeof ACTIVITIES)[number];
const SAFE: RiskResult = { risk: "low", reason: "Village life only; nothing on the computer." };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const stockOf = () => sqlite.prepare("SELECT * FROM economy WHERE id = 1").get() as Record<string, number> | undefined;
const built = (kind: string) => Boolean(sqlite.prepare("SELECT 1 FROM buildings WHERE kind = ? AND status = 'built'").get(kind));

function doActivity(agentId: number, name: string, what: Activity): string {
  const a = sqlite.prepare("SELECT role, trade, is_mayor AS isMayor FROM agents WHERE id = ?").get(agentId) as { role: string; trade: string | null; isMayor: number };
  const life = ensureLife(agentId);
  const trade = tradeOf({ trade: a.trade, role: a.role, isMayor: Boolean(a.isMayor) });
  const t = TRADES[trade];
  const set = (place: string, activity: string, patch: Record<string, number> = {}) => {
    const s = { energy: life.energy, fullness: life.fullness, company: life.company, coins: life.coins, xp: life.xp, ...patch };
    sqlite
      .prepare("UPDATE villager_life SET place = ?, activity = ?, with_id = NULL, energy = ?, fullness = ?, company = ?, coins = ?, xp = ?, updated_at = unixepoch() WHERE agent_id = ?")
      .run(place, activity, clamp(s.energy), clamp(s.fullness), clamp(s.company), Math.max(0, s.coins), s.xp, agentId);
  };
  switch (what) {
    case "work": {
      const stock = stockOf() ?? {};
      let made = t.goods ? 2 + Math.floor(levelOf(life.xp) / 4) : 0;
      if (made && t.building && !built(t.building)) made = 1;
      if (made && "uses" in t && t.uses) {
        const got = stintInputs(t, made, stock);
        made = got.made;
        if (made && got.used) sqlite.prepare(`UPDATE economy SET ${got.used} = MAX(0, ${got.used} - ?) WHERE id = 1`).run(made);
      }
      if (made && t.goods) sqlite.prepare(`UPDATE economy SET ${t.goods} = MIN(999, ${t.goods} + ?) WHERE id = 1`).run(made);
      const xp = life.xp + 6;
      set("work", t.doing, { xp, coins: life.coins + 2, energy: life.energy - 8 });
      if (levelOf(xp) > levelOf(life.xp)) logLife("level", agentId, `${name} is now a ${titleOf(trade, levelOf(xp)).toLowerCase()} (level ${levelOf(xp)}).`);
      return made && t.goods ? `You put in a good stint ${t.doing}: ${made} ${t.goods} for the village, and 2 coins.` : `You put in a good stint ${t.doing}, and earned 2 coins.`;
    }
    case "eat": {
      const stock = stockOf() ?? {};
      const food: Good | null = (stock.bread ?? 0) > 0 ? "bread" : (stock.fish ?? 0) > 0 ? "fish" : null;
      if (!food) return "There's nothing in the village pantry to eat. The farmers, bakers and fishers would help.";
      sqlite.prepare(`UPDATE economy SET ${food} = MAX(0, ${food} - 1) WHERE id = 1`).run();
      set("home", food === "fish" ? "having fish for a meal" : "having a meal", { fullness: life.fullness + 45 });
      return `You had a meal (${food === "fish" ? "some fish" : "a loaf"}). You feel full.`;
    }
    case "rest":
      set("home", "having a rest", { energy: life.energy + 30 });
      return "You had a good rest.";
    case "tavern": {
      if (!built("tavern")) {
        set("plaza", "out for a stroll", { company: life.company + 5 });
        return "There's no tavern yet, so you went for a stroll round the plaza instead.";
      }
      const pay = life.coins >= 2 ? 2 : 0;
      set("tavern", "at the tavern", { company: life.company + 20, coins: life.coins - pay, fullness: life.fullness + (pay ? 10 : 0) });
      return `You went to the tavern${pay ? " and had an ale (2 coins)" : ""}. Good to see some faces.`;
    }
    case "stroll":
      set("plaza", "out for a stroll", { company: life.company + 5, energy: life.energy + 3 });
      return "You took a stroll round the village.";
    default:
      set("home", "relaxing at home", { energy: life.energy + 10 });
      return "You went home to relax.";
  }
}

function visit(agentId: number, name: string, who: string, said: string | null): string {
  const other = sqlite.prepare("SELECT id, name FROM agents WHERE LOWER(name) = LOWER(?) AND status != 'dismissed' AND id != ?").get(who, agentId) as
    | { id: number; name: string }
    | undefined;
  if (!other) return `Nobody called "${who}" lives here.`;
  ensureLife(other.id);
  const [a, b] = agentId < other.id ? [agentId, other.id] : [other.id, agentId];
  const cur = sqlite.prepare("SELECT affinity, status FROM relationships WHERE a_id = ? AND b_id = ?").get(a, b) as { affinity: number; status: string } | undefined;
  const affinity = Math.min(100, (cur?.affinity ?? 0) + 5);
  const keep = cur && ["sweetheart", "partner"].includes(cur.status);
  sqlite
    .prepare("INSERT INTO relationships (a_id, b_id, affinity, status) VALUES (?, ?, ?, ?) ON CONFLICT(a_id, b_id) DO UPDATE SET affinity = excluded.affinity, status = excluded.status, updated_at = unixepoch()")
    .run(a, b, affinity, keep ? cur!.status : statusFor(affinity));
  sqlite.prepare("UPDATE villager_life SET place = 'visit', activity = ?, with_id = ?, company = MIN(100, company + 15), updated_at = unixepoch() WHERE agent_id = ?").run(`visiting ${other.name}`, other.id, agentId);
  sqlite.prepare("UPDATE villager_life SET company = MIN(100, company + 10) WHERE agent_id = ?").run(other.id);
  const line = said?.trim().slice(0, 200);
  logLife("visit", agentId, `${name} dropped in on ${other.name}${line ? `: "${line}"` : "."}`, other.id);
  const now = keep ? cur!.status : statusFor(affinity);
  return `You visited ${other.name}.${now !== (cur?.status ?? "acquaintance") ? ` You're ${now === "friend" ? "friends" : "close friends"} now.` : ""}`;
}

// Buying from the shop (#135): decor goes to their cottage, a treat is eaten.
function buy(agentId: number, name: string, item: string): string {
  if (!isShopKey(item)) return `The shop doesn't sell that. It has: ${SHOP_KEYS.map((k) => `${k} (${SHOP[k].label}, ${SHOP[k].price} coins)`).join(", ")}.`;
  const life = ensureLife(agentId);
  const it = SHOP[item];
  if (life.coins < it.price) return `${it.label} costs ${it.price} coins, and you have ${life.coins}.`;
  const decor = (life.decor as string[] | null) ?? [];
  if (it.kind === "treat") {
    sqlite.prepare("UPDATE villager_life SET coins = coins - ?, fullness = MIN(100, fullness + 30), activity = ? WHERE agent_id = ?").run(it.price, `enjoying ${it.label}`, agentId);
    return `You bought ${it.label} and ate it. Lovely.`;
  }
  if (it.kind === "gift") return `${it.label} is for giving: use gift with who and item "${item}".`;
  sqlite.prepare("UPDATE villager_life SET coins = coins - ?, decor = ?, activity = ? WHERE agent_id = ?").run(it.price, JSON.stringify([...decor, item].slice(-12)), `buying ${it.label} at the market`, agentId);
  logLife("buy", agentId, `${name} bought ${it.label} for their cottage.`);
  return `You bought ${it.label} (${it.price} coins). It's in your cottage now.`;
}

// A gift (#134, #135): coins or something from the shop, for a neighbour.
function gift(agentId: number, name: string, who: string, item: string | null, coins: number): string {
  const other = sqlite.prepare("SELECT id, name FROM agents WHERE LOWER(name) = LOWER(?) AND status != 'dismissed' AND id != ?").get(who, agentId) as
    | { id: number; name: string }
    | undefined;
  if (!other) return `Nobody called "${who}" lives here.`;
  const life = ensureLife(agentId);
  ensureLife(other.id);
  const cost = item && isShopKey(item) ? SHOP[item].price : Math.max(0, Math.floor(coins));
  if (!cost) return "Say what to give: an `item` from the shop, or some `coins`.";
  if (life.coins < cost) return `That's ${cost} coins, and you have ${life.coins}.`;
  sqlite.prepare("UPDATE villager_life SET coins = coins - ? WHERE agent_id = ?").run(cost, agentId);
  if (item && isShopKey(item) && (SHOP[item].kind === "floor" || SHOP[item].kind === "wall")) {
    const theirs = (ensureLife(other.id).decor as string[] | null) ?? [];
    sqlite.prepare("UPDATE villager_life SET decor = ? WHERE agent_id = ?").run(JSON.stringify([...theirs, item].slice(-12)), other.id);
  } else if (!item) sqlite.prepare("UPDATE villager_life SET coins = coins + ? WHERE agent_id = ?").run(cost, other.id);
  const [a, b] = agentId < other.id ? [agentId, other.id] : [other.id, agentId];
  const cur = (sqlite.prepare("SELECT affinity, romance, status FROM relationships WHERE a_id = ? AND b_id = ?").get(a, b) as { affinity: number; romance: number; status: string } | undefined) ?? {
    affinity: 0,
    romance: 0,
    status: "acquaintance",
  };
  const affinity = Math.min(100, cur.affinity + 8);
  const open = sqlite.prepare("SELECT COUNT(*) AS n FROM villager_life WHERE agent_id IN (?, ?) AND romance_open = 1").get(a, b) as { n: number };
  const love = romanceStep({ ...cur, affinity }, open.n === 2, 6, () => 0);
  sqlite
    .prepare("INSERT INTO relationships (a_id, b_id, affinity, romance, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT(a_id, b_id) DO UPDATE SET affinity = excluded.affinity, romance = excluded.romance, status = excluded.status, updated_at = unixepoch()")
    .run(a, b, affinity, love.romance, love.status);
  const what = item && isShopKey(item) ? SHOP[item].label : `${cost} coins`;
  logLife("gift", agentId, `${name} gave ${other.name} ${what}.`, other.id);
  if (love.event === "sweethearts") logLife("romance", agentId, `${name} and ${other.name} are sweethearts.`, other.id);
  return `You gave ${other.name} ${what}. They were pleased.`;
}

export const LIFE_TOOLS: Record<string, LifeTool> = {
  buy: {
    definition: {
      type: "function" as const,
      function: {
        name: "buy",
        description: "Buy something at the market with your coins: decor for your cottage, a treat, or flowers to give.",
        parameters: { type: "object", properties: { item: { type: "string", enum: SHOP_KEYS } }, required: ["item"] },
      },
    },
    risk: SAFE,
    run: async (args, ctx) => {
      if (!ctx?.agentId || !ctx.agentName) return { output: "Only a villager can do that.", summary: "buy refused" };
      return { output: buy(ctx.agentId, ctx.agentName, String(args.item ?? "")), summary: `life: buy ${String(args.item ?? "")}` };
    },
  },
  gift: {
    definition: {
      type: "function" as const,
      function: {
        name: "gift",
        description: "Give a neighbour something: an item from the shop (you pay for it) or some of your coins.",
        parameters: { type: "object", properties: { who: { type: "string" }, item: { type: "string", enum: SHOP_KEYS }, coins: { type: "number" } }, required: ["who"] },
      },
    },
    risk: SAFE,
    run: async (args, ctx) => {
      if (!ctx?.agentId || !ctx.agentName) return { output: "Only a villager can do that.", summary: "gift refused" };
      return {
        output: gift(ctx.agentId, ctx.agentName, String(args.who ?? ""), args.item ? String(args.item) : null, Number(args.coins) || 0),
        summary: `life: gift ${String(args.who ?? "")}`,
      };
    },
  },
  accept_order: {
    definition: {
      type: "function" as const,
      function: {
        name: "accept_order",
        description: "Take on an order from a neighbouring town (the Mayor or a trader). Without `order`, lists the open ones.",
        parameters: { type: "object", properties: { order: { type: "number", description: "The order's number." } } },
      },
    },
    risk: SAFE,
    run: async (args, ctx) => (await import("./orders")).acceptOrderTool(args, ctx),
  },
  do_activity: {
    definition: {
      type: "function" as const,
      function: {
        name: "do_activity",
        description:
          "Do something with your time in the village: work your trade (makes goods for the village and earns coins), eat, rest, go to the tavern, take a stroll, or go home.",
        parameters: { type: "object", properties: { what: { type: "string", enum: [...ACTIVITIES] } }, required: ["what"] },
      },
    },
    risk: SAFE,
    run: async (args, ctx) => {
      if (!ctx?.agentId || !ctx.agentName) return { output: "Only a villager can do that.", summary: "activity refused" };
      const what = ACTIVITIES.includes(args.what as Activity) ? (args.what as Activity) : "home";
      return { output: doActivity(ctx.agentId, ctx.agentName, what), summary: `life: ${what}` };
    },
  },
  // Letters (#172): the mailbox is a good use of a quiet moment.
  write_letter: {
    definition: {
      type: "function" as const,
      function: {
        name: "write_letter",
        description:
          "Write a letter to a neighbour. It waits in their mailbox and they answer in their own time; the answer comes to your mailbox (read_letters). Use it for things that can wait: news, plans, thanks, a request. To answer a letter, give reply_to and leave out to and subject.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "The neighbour's name." },
            subject: { type: "string", description: "A few words." },
            body: { type: "string", description: "The letter, plainly. A few sentences is plenty." },
            reply_to: { type: "number", description: "The number of the letter you're answering." },
          },
          required: ["body"],
        },
      },
    },
    risk: SAFE,
    run: async (args, ctx) => (await import("./letters")).writeLetterTool(args, ctx),
  },
  read_letters: {
    definition: {
      type: "function" as const,
      function: {
        name: "read_letters",
        description: "Open your mailbox: new letters (marked read once you've seen them) and the latest ones. With `letter`, read that letter's whole thread.",
        parameters: { type: "object", properties: { letter: { type: "number", description: "A letter's number." } } },
      },
    },
    risk: SAFE,
    run: async (args, ctx) => (await import("./letters")).readLettersTool(args, ctx),
  },
  visit: {
    definition: {
      type: "function" as const,
      function: {
        name: "visit",
        description: "Drop in on a neighbour for a chat. Friends grow closer this way. `said` is what you say to them, in a sentence.",
        parameters: { type: "object", properties: { who: { type: "string" }, said: { type: "string" } }, required: ["who"] },
      },
    },
    risk: SAFE,
    run: async (args, ctx) => {
      if (!ctx?.agentId || !ctx.agentName) return { output: "Only a villager can do that.", summary: "visit refused" };
      return { output: visit(ctx.agentId, ctx.agentName, String(args.who ?? ""), args.said ? String(args.said) : null), summary: `life: visit ${String(args.who ?? "")}` };
    },
  },
};

// Everything a life turn may call: the life tools and their diary.
export const LIFE_TOOL_NAMES = [...Object.keys(LIFE_TOOLS), "update_journal"];
