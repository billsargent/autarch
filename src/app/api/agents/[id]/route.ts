import { NextResponse } from "next/server";
import { db } from "@/db";
import { agents, conversations, jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setDaydream, validateAgentInput } from "@/lib/agent/agents";
import { ALL_TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { requestCancel } from "@/lib/agent/turnLock";

type Params = { params: Promise<{ id: string }> };

async function find(id: string) {
  const [row] = await db.select().from(agents).where(eq(agents.id, Number(id)));
  return row && row.status !== "dismissed" ? row : null;
}

// Change a villager: name, role, personality, look, model, tools, limits, or
// pause / let them work again.
export async function PATCH(req: Request, { params }: Params) {
  const agent = await find((await params).id);
  if (!agent) return NextResponse.json({ error: "No such villager." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const checked = validateAgentInput(body, ALL_TOOL_DEFINITIONS.map((t) => t.function.name), false);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const [updated] = await db
    .update(agents)
    .set({
      ...checked.value,
      ...(checked.value.status ? { pausedBy: checked.value.status === "paused" ? ("owner" as const) : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agent.id))
    .returning();
  // Free time on or off (#59).
  if (typeof body.daydream === "boolean") await setDaydream(updated, body.daydream);
  // Pausing stops what they're doing now, too.
  if (checked.value.status === "paused") {
    const theirs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.agentId, agent.id));
    for (const c of theirs) requestCancel(c.id);
  }
  return NextResponse.json({ agent: updated });
}

// Dismiss a villager: they leave the village. Their conversations, diary and
// spending stay on record; their jobs stop. The Mayor can't be dismissed.
export async function DELETE(_req: Request, { params }: Params) {
  const agent = await find((await params).id);
  if (!agent) return NextResponse.json({ error: "No such villager." }, { status: 404 });
  if (agent.isMayor) return NextResponse.json({ error: "The Mayor can't be dismissed." }, { status: 409 });
  await db.update(agents).set({ status: "dismissed", updatedAt: new Date() }).where(eq(agents.id, agent.id));
  await db.update(jobs).set({ enabled: false, updatedAt: new Date() }).where(eq(jobs.agentId, agent.id));
  const theirs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.agentId, agent.id));
  for (const c of theirs) requestCancel(c.id);
  return NextResponse.json({ ok: true });
}
