import { NextResponse } from "next/server";
import { createVillager, listVillagers, validateAgentInput, villagerStates } from "@/lib/agent/agents";
import { ALL_TOOL_DEFINITIONS } from "@/lib/agent/tools";

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
  const created = await createVillager(checked.value);
  return NextResponse.json({ agent: created });
}
