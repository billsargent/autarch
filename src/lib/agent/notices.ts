import { sqlite } from "@/db";
import type { ToolContext } from "./tools";

// Notices on the village board (#147): news, agreed terms, reminders. Unlike
// ideas they aren't voted on; they stay up until the owner takes them down
// or newer ones push them off.

export const NOTICES_PER_DAY = 3;
export const NOTICES_SHOWN = 12;

export interface NoticeRow {
  id: number;
  title: string;
  body: string | null;
  agentId: number | null;
  createdAt: number; // ms
}

export function listNotices(): NoticeRow[] {
  return sqlite
    .prepare("SELECT id, title, body, agent_id AS agentId, created_at * 1000 AS createdAt FROM notices WHERE removed_at IS NULL ORDER BY id DESC LIMIT ?")
    .all(NOTICES_SHOWN) as NoticeRow[];
}

export function removeNotice(id: number): boolean {
  return sqlite.prepare("UPDATE notices SET removed_at = unixepoch() WHERE id = ? AND removed_at IS NULL").run(id).changes > 0;
}

export async function pinNoticeTool(args: Record<string, unknown>, ctx?: ToolContext) {
  if (!ctx?.agentId) return { output: "Refused: only a villager can pin a notice.", summary: "notice refused" };
  const title = String(args.title ?? "").trim().slice(0, 120);
  const text = String(args.text ?? "").trim().slice(0, 2000);
  if (!title || !text) return { output: "Refused: a notice needs a `title` and some `text`.", summary: "notice refused" };
  const since = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const today = (sqlite.prepare("SELECT COUNT(*) AS n FROM notices WHERE agent_id = ? AND created_at >= ?").get(ctx.agentId, since) as { n: number }).n;
  if (today >= NOTICES_PER_DAY) return { output: `Refused: you've pinned ${NOTICES_PER_DAY} notices today. Tomorrow.`, summary: "notice refused" };
  const id = Number(sqlite.prepare("INSERT INTO notices (title, body, agent_id) VALUES (?, ?, ?)").run(title, text, ctx.agentId).lastInsertRowid);
  return { output: `Pinned notice #${id} on the village board: "${title}".`, summary: `notice #${id}` };
}
