import { db, sqlite } from "@/db";
import { drafts } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import type { ToolContext } from "./tools";

// The outbox (#107, docs/town-charter.md section 2). Anything meant to leave
// the machine (an email, a post, a listing, a message to someone) is only
// ever saved as a draft. The owner reads it, edits it if they like, and
// approves or discards it; only an approved draft is sent, by whatever
// connector handles its kind (#108). With no connector, approving marks it
// ready for the owner to send themselves.

export type DraftRow = typeof drafts.$inferSelect;
export const DRAFT_KINDS = ["email", "post", "listing", "message", "other"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const DRAFTS_PER_DAY = 10;

export class DraftError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

// How a kind of draft is sent once approved; none yet (connectors come with #108).
type Sender = (d: DraftRow) => Promise<string>;
const SENDERS: Partial<Record<DraftKind, Sender>> = {};

export async function saveDraftTool(args: Record<string, unknown>, ctx?: ToolContext) {
  if (!ctx?.agentId) return { output: "Refused: only a villager can write a draft.", summary: "draft refused" };
  const kind = DRAFT_KINDS.includes(args.kind as DraftKind) ? (args.kind as DraftKind) : "other";
  const content = String(args.content ?? "").trim();
  if (!content) return { output: "Refused: a draft needs some `content`.", summary: "draft refused" };
  const since = Math.floor(Date.now() / 1000) - 86400;
  const { n } = sqlite.prepare("SELECT COUNT(*) AS n FROM drafts WHERE agent_id = ? AND created_at >= ?").get(ctx.agentId, since) as { n: number };
  if (n >= DRAFTS_PER_DAY) return { output: `Refused: you've written ${DRAFTS_PER_DAY} drafts today.`, summary: "draft refused" };
  const [row] = await db
    .insert(drafts)
    .values({
      kind,
      target: args.to ? String(args.to).slice(0, 300) : null,
      subject: args.subject ? String(args.subject).slice(0, 300) : null,
      content: content.slice(0, 20000),
      agentId: ctx.agentId,
      conversationId: ctx.conversationId ?? null,
    })
    .returning();
  return {
    output: `Saved draft #${row.id} (${kind}${row.target ? ` to ${row.target}` : ""}) in the owner's outbox. Nothing has been sent: the owner reads it and decides.`,
    summary: `draft #${row.id}`,
  };
}

export async function listDrafts(limit = 40) {
  return db.select().from(drafts).orderBy(desc(drafts.id)).limit(limit);
}

// The owner's decision. `edits` lets them change the words before it goes.
export async function decideDraft(id: number, action: "approve" | "discard", edits?: { content?: string; subject?: string | null; target?: string | null }) {
  const [d] = await db.select().from(drafts).where(eq(drafts.id, id));
  if (!d) throw new DraftError("No such draft.", 404);
  if (d.status !== "draft") throw new DraftError(`That draft is already ${d.status}.`);
  if (action === "discard") {
    await db.update(drafts).set({ status: "discarded", decidedAt: new Date() }).where(eq(drafts.id, id));
    return;
  }
  const changed = {
    ...(edits?.content?.trim() ? { content: edits.content.trim() } : {}),
    ...(edits && "subject" in edits ? { subject: edits.subject || null } : {}),
    ...(edits && "target" in edits ? { target: edits.target || null } : {}),
  };
  const [ready] = await db.update(drafts).set({ ...changed, status: "approved", decidedAt: new Date() }).where(eq(drafts.id, id)).returning();
  const sender = SENDERS[ready.kind as DraftKind];
  if (!sender) return; // approved: the owner sends it themselves
  try {
    const result = await sender(ready);
    await db.update(drafts).set({ status: "sent", sendResult: result }).where(eq(drafts.id, id));
  } catch (err) {
    await db.update(drafts).set({ status: "failed", sendResult: err instanceof Error ? err.message : String(err) }).where(eq(drafts.id, id));
  }
}
