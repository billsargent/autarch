import { sqlite } from "@/db";

// Housekeeping (#197): the village keeps a record of nearly everything, and
// most of it only grows: notices, ideas, finished goals, the chronicle, the
// guard tower's log, the villagers' own threads. Once a day (the worker) or
// when the owner asks, what's long out of date is taken down or let go.
// - Never touched: the owner's own chats (any conversation the owner wrote
//   in), approvals still waiting, open goals worked on recently, weddings in
//   the chronicle, work sessions (every spending figure comes from them),
//   the villagers' own notes (reflections, ideas) and open diary tasks.
// - `historyDays` (a setting, default 90) is how long the record is kept;
//   the board's short-lived things go sooner.

export const NOTICE_DAYS = 14; // a notice is news for two weeks
export const STALE_GOAL_DAYS = 30; // a backlog goal nobody touched in a month is set aside
export const DONE_DAYS = 30; // finished goals, turned-down ideas, read letters to the owner, settled orders
export const DEFAULT_HISTORY_DAYS = 90;

export interface TidyResult {
  at: number; // unix seconds
  counts: Record<string, number>;
}

export function ensureHousekeepingTable() {
  sqlite.exec("CREATE TABLE IF NOT EXISTS housekeeping (id INTEGER PRIMARY KEY, last_run INTEGER, last_day TEXT, result TEXT)");
}

const has = (table: string) => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));

export function tidyUp(historyDays = DEFAULT_HISTORY_DAYS, now = new Date()): TidyResult {
  ensureHousekeepingTable();
  const nowSec = Math.floor(now.getTime() / 1000);
  const ago = (days: number) => nowSec - days * 86400;
  const keep = ago(Math.max(14, historyDays));
  const counts: Record<string, number> = {};
  const run = (label: string, sql: string, ...args: unknown[]) => {
    const n = sqlite.prepare(sql).run(...args).changes;
    if (n) counts[label] = (counts[label] ?? 0) + n;
  };

  sqlite.transaction(() => {
    // The board: notices are news; goals and ideas move on.
    run("notices taken down", "UPDATE notices SET removed_at = ? WHERE removed_at IS NULL AND created_at < ?", nowSec, ago(NOTICE_DAYS));
    run("old notices", "DELETE FROM notices WHERE removed_at IS NOT NULL AND removed_at < ?", keep);
    run(
      "goals set aside (untouched for a month)",
      "UPDATE goals SET status = 'abandoned', updated_at = ? WHERE status = 'backlog' AND updated_at < ?",
      nowSec,
      ago(STALE_GOAL_DAYS),
    );
    run("finished goals", "DELETE FROM goals WHERE status IN ('done', 'abandoned') AND updated_at < ?", ago(DONE_DAYS));
    run("turned-down ideas", "DELETE FROM ideas WHERE status IN ('rejected', 'vetoed') AND COALESCE(decided_at, created_at) < ?", ago(DONE_DAYS));
    run("adopted ideas", "DELETE FROM ideas WHERE status = 'adopted' AND COALESCE(decided_at, created_at) < ?", keep);

    // The owner's mailbox.
    run("read letters in your mailbox", "DELETE FROM notifications WHERE read = 1 AND created_at < ?", ago(DONE_DAYS));
    run("unread letters in your mailbox", "DELETE FROM notifications WHERE read = 0 AND created_at < ?", keep);

    // The record.
    run("chronicle entries", "DELETE FROM life_events WHERE kind != 'wedding' AND created_at < ?", keep);
    run("guard tower log entries", "DELETE FROM tool_executions WHERE status NOT IN ('pending', 'awaiting_approval') AND requested_at < ?", keep);
    // The villagers' own threads (work windows, own time, votes, neighbours,
    // research): only conversations the owner never wrote in.
    run(
      "messages in the villagers' own threads",
      `DELETE FROM messages WHERE created_at < ? AND conversation_id IN (
         SELECT c.id FROM conversations c WHERE NOT EXISTS (SELECT 1 FROM messages u WHERE u.conversation_id = c.id AND u.role = 'user'))`,
      keep,
    );
    run("finished diary tasks", "DELETE FROM journal_entries WHERE category IN ('task', 'system') AND status IN ('done', 'abandoned') AND updated_at < ?", keep);

    // Done and dusted.
    if (has("letters")) run("read letters between villagers", "DELETE FROM letters WHERE read_at IS NOT NULL AND created_at < ?", keep);
    if (has("happenings")) run("happenings", "DELETE FROM happenings WHERE created_at < ?", ago(DONE_DAYS));
    if (has("village_events")) run("past calendar events", "DELETE FROM village_events WHERE (cancelled = 1 OR COALESCE(ends_at, starts_at) < ?) AND created_at < ?", ago(60), ago(60));
    if (has("trade_orders")) run("settled orders", "DELETE FROM trade_orders WHERE status IN ('delivered', 'expired') AND COALESCE(done_at, due_at) < ?", ago(DONE_DAYS));
    run("old drafts", "DELETE FROM drafts WHERE status NOT IN ('draft', 'approved') AND created_at < ?", keep);
    if (has("hire_requests")) run("settled hire requests", "DELETE FROM hire_requests WHERE status NOT IN ('interviewing', 'awaiting_owner') AND created_at < ?", keep);
    run("past meetings", "DELETE FROM meetings WHERE status = 'closed' AND created_at < ?", keep);
    if (has("research_projects")) {
      const finished = "SELECT id FROM research_projects WHERE status IN ('done', 'failed', 'cancelled') AND COALESCE(finished_at, created_at) < ?";
      run("notes of finished research", `DELETE FROM research_notes WHERE project_id IN (${finished})`, keep);
      run("questions of finished research", `DELETE FROM research_questions WHERE project_id IN (${finished})`, keep);
    }
  })();

  const result = { at: nowSec, counts };
  sqlite
    .prepare("INSERT INTO housekeeping (id, last_run, last_day, result) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_run = excluded.last_run, last_day = excluded.last_day, result = excluded.result")
    .run(nowSec, now.toDateString(), JSON.stringify(counts));
  return result;
}

// The worker's once-a-day round.
export function dailyTidy(historyDays: number, now = new Date()): TidyResult | null {
  ensureHousekeepingTable();
  const last = sqlite.prepare("SELECT last_day FROM housekeeping WHERE id = 1").get() as { last_day: string | null } | undefined;
  if (last?.last_day === now.toDateString()) return null;
  return tidyUp(historyDays, now);
}

export function lastTidy(): TidyResult | null {
  ensureHousekeepingTable();
  const r = sqlite.prepare("SELECT last_run, result FROM housekeeping WHERE id = 1").get() as { last_run: number | null; result: string | null } | undefined;
  return r?.last_run ? { at: r.last_run, counts: JSON.parse(r.result ?? "{}") } : null;
}
