import { NextResponse } from "next/server";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { listVillagers, slugify, validateAgentInput, villagerStates } from "@/lib/agent/agents";
import { ALL_TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { CHARACTER_KEYS, VILLAGER_COLORS } from "@/lib/agent/villagerLooks";

export const dynamic = "force-dynamic";

// The villagers (#55), with what each is up to right now.
export async function GET() {
  const list = await listVillagers();
  const states = villagerStates(list.map((a) => a.id));
  return NextResponse.json({ agents: list.map((a) => ({ ...a, ...states.get(a.id) })) });
}

// Add a villager. Only the owner can (this API needs a signed-in session, and
// the agents' own tools can't reach it).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const checked = validateAgentInput(body, ALL_TOOL_DEFINITIONS.map((t) => t.function.name), true);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const everyone = await db.select().from(agents);
  // A home folder of their own, and a look and colour nobody else has yet if possible.
  const homes = new Set(everyone.map((a) => a.home));
  const base = `villagers/${slugify(checked.value.name!)}`;
  let home = base;
  for (let i = 2; homes.has(home); i++) home = `${base}-${i}`;
  const usedLooks = new Set(everyone.filter((a) => a.status !== "dismissed").map((a) => a.character));
  const usedColors = new Set(everyone.filter((a) => a.status !== "dismissed").map((a) => a.color));
  const [created] = await db
    .insert(agents)
    .values({
      name: checked.value.name!,
      role: checked.value.role ?? "Villager",
      persona: checked.value.persona ?? null,
      character: checked.value.character ?? CHARACTER_KEYS.find((c) => c !== "master" && !usedLooks.has(c)) ?? "villager",
      color: checked.value.color ?? VILLAGER_COLORS.find((c) => !usedColors.has(c)) ?? VILLAGER_COLORS[1],
      model: checked.value.model ?? null,
      enabledTools: checked.value.enabledTools ?? null,
      dailyBudgetUsd: checked.value.dailyBudgetUsd ?? null,
      maxActionsPerHour: checked.value.maxActionsPerHour ?? null,
      home,
    })
    .returning();
  return NextResponse.json({ agent: created });
}
