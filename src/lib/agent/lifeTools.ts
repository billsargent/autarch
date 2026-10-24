import type OpenAI from "openai";
import { sqlite } from "@/db";
import { ensureLife, logLife, statusFor } from "./life";
import type { RiskResult } from "./risk";
import type { ToolContext } from "./tools";
import { TRADES, levelOf, titleOf, tradeOf, type Good } from "./trades";

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
      if (made && "uses" in t && t.uses) made = Math.min(made, stock[t.uses] ?? 0);
      if (made && "uses" in t && t.uses) sqlite.prepare(`UPDATE economy SET ${t.uses} = MAX(0, ${t.uses} - ?) WHERE id = 1`).run(made);
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

export const LIFE_TOOLS: Record<string, LifeTool> = {
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
