import { sqlite } from "@/db";

// One turn per conversation (#18), and Stop that works in any process (#19).
//
// A turn claims its conversation by inserting its work session inside an
// IMMEDIATE transaction (SQLite's write lock, shared by the web server and the
// worker), so two turns can never interleave their messages. A running
// session keeps a heartbeat; one that has gone quiet for longer than
// ABANDONED_AFTER_MS belonged to a process that stopped (crash, restart), so
// it no longer holds the conversation. Stop sets cancel_requested on the
// session in the database, which the runner checks at every step and while
// the model streams — whichever process is running the turn.

export const HEARTBEAT_MS = 20_000;
export const ABANDONED_AFTER_MS = 90_000;

export class TurnBusyError extends Error {
  status = 409;
  constructor(public conversationId: number) {
    super("The agent is already working in this conversation. Wait for it to finish, or press Stop.");
  }
}

type Trigger = "chat" | "approval" | "scheduled" | "report" | "message" | "interview" | "meeting";

interface RunningRow {
  id: number;
  started_at: number;
  heartbeat_at: number | null;
}

// Whether a running session's process is gone: no heartbeat for too long. A
// session from before heartbeats existed is judged by its start time.
export function isAbandoned(row: { started_at: number; heartbeat_at: number | null }, nowMs: number): boolean {
  const lastSign = (row.heartbeat_at ?? row.started_at) * 1000;
  return nowMs - lastSign > ABANDONED_AFTER_MS;
}

const nowSec = (ms: number) => Math.floor(ms / 1000);

function runningFor(conversationId: number): RunningRow[] {
  return sqlite
    .prepare("SELECT id, started_at, heartbeat_at FROM work_sessions WHERE conversation_id = ? AND status = 'running'")
    .all(conversationId) as RunningRow[];
}

function markAbandoned(id: number, nowMs: number) {
  sqlite
    .prepare("UPDATE work_sessions SET status = 'failed', ended_at = ?, reason = ? WHERE id = ? AND status = 'running'")
    .run(nowSec(nowMs), "interrupted: the process running this turn stopped", id);
}

// Claim the conversation for a new turn and create its work session. Throws
// TurnBusyError if another live turn holds it.
export function claimTurn(opts: {
  conversationId: number;
  trigger: Trigger;
  jobId?: number | null;
  agentId?: number | null;
  nowMs?: number;
}): { id: number; startedAt: Date } {
  const nowMs = opts.nowMs ?? Date.now();
  const claim = sqlite.transaction(() => {
    for (const row of runningFor(opts.conversationId)) {
      if (!isAbandoned(row, nowMs)) throw new TurnBusyError(opts.conversationId);
      markAbandoned(row.id, nowMs);
    }
    const started = nowSec(nowMs);
    const info = sqlite
      .prepare(
        "INSERT INTO work_sessions (job_id, conversation_id, trigger, status, started_at, heartbeat_at, cancel_requested, agent_id) VALUES (?, ?, ?, 'running', ?, ?, 0, ?)",
      )
      .run(opts.jobId ?? null, opts.conversationId, opts.trigger, started, started, opts.agentId ?? null);
    return { id: Number(info.lastInsertRowid), startedAt: new Date(started * 1000) };
  });
  return claim.immediate();
}

// Whether a live turn is running in the conversation right now.
export function isConversationBusy(conversationId: number, nowMs = Date.now()): boolean {
  return runningFor(conversationId).some((row) => !isAbandoned(row, nowMs));
}

export function heartbeat(sessionId: number, nowMs = Date.now()) {
  sqlite.prepare("UPDATE work_sessions SET heartbeat_at = ? WHERE id = ? AND status = 'running'").run(nowSec(nowMs), sessionId);
}

// Ask the conversation's running turn to stop. A turn whose process is gone
// can't hear it, so it's released on the spot. Returns how many turns were
// asked to stop.
export function requestCancel(conversationId: number, nowMs = Date.now()): number {
  let asked = 0;
  for (const row of runningFor(conversationId)) {
    if (isAbandoned(row, nowMs)) markAbandoned(row.id, nowMs);
    else {
      sqlite.prepare("UPDATE work_sessions SET cancel_requested = 1 WHERE id = ?").run(row.id);
      asked++;
    }
  }
  return asked;
}

export function isCancelRequested(sessionId: number): boolean {
  const row = sqlite.prepare("SELECT cancel_requested FROM work_sessions WHERE id = ?").get(sessionId) as
    | { cancel_requested: number }
    | undefined;
  return Boolean(row?.cancel_requested);
}

// Release running sessions whose process has gone quiet, everywhere (the
// worker's reaper calls this). Returns their ids and jobs.
export function releaseAbandoned(nowMs = Date.now()): Array<{ id: number; jobId: number | null }> {
  const rows = sqlite
    .prepare("SELECT id, job_id, started_at, heartbeat_at FROM work_sessions WHERE status = 'running' AND heartbeat_at IS NOT NULL")
    .all() as Array<RunningRow & { job_id: number | null }>;
  const released: Array<{ id: number; jobId: number | null }> = [];
  for (const row of rows) {
    if (isAbandoned(row, nowMs)) {
      markAbandoned(row.id, nowMs);
      released.push({ id: row.id, jobId: row.job_id });
    }
  }
  return released;
}
