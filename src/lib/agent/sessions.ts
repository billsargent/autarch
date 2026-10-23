import { db } from "@/db";
import { jobs, workSessions } from "@/db/schema";
import { and, eq, lt, max } from "drizzle-orm";
import { getSettings } from "./settingsStore";
import { releaseAbandoned } from "./turnLock";

// A session left "running" by a process that stopped mid-turn (crash, restart,
// deploy) would block every scheduled job forever, because the worker never
// starts work while something is running (#23). No turn can legitimately run
// longer than the longest allowed duration, so anything older than that plus a
// grace period is cleaned up.

export const STALE_GRACE_MINUTES = 15;

export function isStale(startedAt: Date, now: Date, maxTurnMinutes: number): boolean {
  return now.getTime() - startedAt.getTime() > (maxTurnMinutes + STALE_GRACE_MINUTES) * 60_000;
}

// Marks stale running sessions as failed and clears "running" on their jobs.
// Returns how many sessions were cleaned up.
export async function reapStaleSessions(now = new Date()): Promise<number> {
  const settings = await getSettings();
  const longestJob = await db.select({ m: max(jobs.maxDurationMinutes) }).from(jobs);
  const maxTurnMinutes = Math.max(settings.maxSessionMinutes, Number(longestJob[0]?.m ?? 0));
  const cutoff = new Date(now.getTime() - (maxTurnMinutes + STALE_GRACE_MINUTES) * 60_000);

  // Sessions with a heartbeat are released as soon as it goes quiet; older
  // ones (from before heartbeats) by their start time.
  const released = releaseAbandoned(now.getTime());
  const timedOut = await db
    .update(workSessions)
    .set({ status: "failed", endedAt: now, reason: "interrupted: the process stopped mid-turn" })
    .where(and(eq(workSessions.status, "running"), lt(workSessions.startedAt, cutoff)))
    .returning({ id: workSessions.id, jobId: workSessions.jobId });
  const reaped = [...released, ...timedOut];

  for (const s of reaped) {
    if (s.jobId) {
      await db
        .update(jobs)
        .set({ lastStatus: "interrupted", lastError: "The run was interrupted (the process stopped mid-turn).", updatedAt: now })
        .where(and(eq(jobs.id, s.jobId), eq(jobs.lastStatus, "running")));
    }
  }
  return reaped.length;
}
