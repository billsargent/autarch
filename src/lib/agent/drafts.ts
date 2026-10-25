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

// How a kind of draft is sent once approved. Email goes out over the owner's
// SMTP server (#124) once it's set up; until then, and for the other kinds,
// approving marks a draft ready for the owner to send themselves.
type Sender = (d: DraftRow) => Promise<string>;
const SENDERS: Partial<Record<DraftKind, Sender>> = {
  email: async (d) => {
    const writer = d.agentId ? (sqlite.prepare("SELECT name FROM agents WHERE id = ?").get(d.agentId) as { name: string } | undefined)?.name : null;
    return (await import("./email")).sendMail({ to: d.target ?? "", subject: d.subject, text: d.content, writer });
  },
};

// Every address an email has gone to (#143), lower-cased.
export function knownAddresses(): Set<string> {
  const rows = sqlite.prepare("SELECT target FROM drafts WHERE kind = 'email' AND status = 'sent' AND target IS NOT NULL").all() as Array<{ target: string }>;
  const out = new Set<string>();
  for (const r of rows) for (const part of r.target.split(/[,;]/)) {
    const a = (/<([^>]+)>/.exec(part)?.[1] ?? part).trim().toLowerCase();
    if (a) out.add(a);
  }
  return out;
}

// The addresses in `target` that have never been emailed.
export function newAddresses(target: string | null, known = knownAddresses()): string[] {
  return (target ?? "")
    .split(/[,;]/)
    .map((p) => (/<([^>]+)>/.exec(p)?.[1] ?? p).trim())
    .filter((a) => a && !known.has(a.toLowerCase()));
}

// Before an email goes (#143): today's cap, and "only people I've emailed before".
function mailRules(d: DraftRow): string | null {
  const m = sqlite.prepare("SELECT daily_cap AS cap, known_only AS knownOnly FROM mail_settings WHERE id = 1").get() as { cap: number; knownOnly: number } | undefined;
  if (!m) return null;
  const since = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const sent = (sqlite.prepare("SELECT COUNT(*) AS n FROM drafts WHERE kind = 'email' AND status = 'sent' AND sent_at >= ?").get(since) as { n: number }).n;
  if (sent >= m.cap) return `Today's limit of ${m.cap} emails is reached (Mayor's ledger → Email). It stays here for tomorrow.`;
  const fresh = newAddresses(d.target);
  if (m.knownOnly && fresh.length) return `${fresh.join(", ")} ${fresh.length === 1 ? "hasn't" : "haven't"} been emailed before, and you've chosen to send only to people you've emailed. Change that on the Email page to send it.`;
  return null;
}
const senderReady: Partial<Record<DraftKind, () => Promise<boolean>>> = {
  email: async () => (await import("./email")).publicMail(await (await import("./email")).getMail()).smtpReady,
};

export async function saveDraftTool(args: Record<string, unknown>, ctx?: ToolContext) {
  if (!ctx?.agentId) return { output: "Refused: only a villager can write a draft.", summary: "draft refused" };
  const kind = DRAFT_KINDS.includes(args.kind as DraftKind) ? (args.kind as DraftKind) : "other";
  const content = String(args.content ?? "").trim();
  if (!content) return { output: "Refused: a draft needs some `content`.", summary: "draft refused" };
  // Why it's being written, for the owner (#143).
  const why = String(args.why ?? "").trim();
  if (!why) return { output: "Refused: say `why` you're writing it, in a sentence, so the owner knows (e.g. \"you asked me to order flour\").", summary: "draft refused" };
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
      why: why.slice(0, 300),
    })
    .returning();
  return {
    output: `Saved draft #${row.id} (${kind}${row.target ? ` to ${row.target}` : ""}) in the owner's outbox. Nothing has been sent: the owner reads it and decides.`,
    summary: `draft #${row.id}`,
  };
}

// The outbox, with any addresses never emailed before flagged (#143).
export async function listDrafts(limit = 40) {
  const known = knownAddresses();
  const rows = await db.select().from(drafts).orderBy(desc(drafts.id)).limit(limit);
  return rows.map((d) => ({ ...d, newRecipients: d.kind === "email" && d.status === "draft" ? newAddresses(d.target, known) : [] }));
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
  if (d.kind === "email") {
    const blocked = mailRules({ ...d, target: edits && "target" in edits ? edits.target || null : d.target });
    if (blocked && (await senderReady.email!())) throw new DraftError(blocked);
  }
  const changed = {
    ...(edits?.content?.trim() ? { content: edits.content.trim() } : {}),
    ...(edits && "subject" in edits ? { subject: edits.subject || null } : {}),
    ...(edits && "target" in edits ? { target: edits.target || null } : {}),
  };
  const [ready] = await db.update(drafts).set({ ...changed, status: "approved", decidedAt: new Date() }).where(eq(drafts.id, id)).returning();
  const sender = SENDERS[ready.kind as DraftKind];
  const canSend = senderReady[ready.kind as DraftKind];
  if (!sender || (canSend && !(await canSend()))) return; // approved: the owner sends it themselves
  try {
    const result = await sender(ready);
    await db.update(drafts).set({ status: "sent", sendResult: result, sentAt: new Date() }).where(eq(drafts.id, id));
  } catch (err) {
    await db.update(drafts).set({ status: "failed", sendResult: err instanceof Error ? err.message : String(err) }).where(eq(drafts.id, id));
  }
}
