import { db } from "@/db";
import { workSessions } from "@/db/schema";
import { and, count, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import type { AgentSettingsRow } from "./settingsStore";

// Enforce "how often it starts working" (cooldown + daily cap). Applies to
// autonomous (scheduled/report) sessions only, not human-initiated chat.
// The daily cap and the gap between sessions count each villager's own work
// windows (#148): a bigger village doesn't share one allowance.
export async function checkWorkAllowed(settings: AgentSettingsRow, agentId: number | null): Promise<{ allowed: boolean; reason?: string }> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const whose = agentId == null ? isNull(workSessions.agentId) : eq(workSessions.agentId, agentId);

  const todayRows = await db
    .select({ n: count() })
    .from(workSessions)
    .where(
      and(
        gte(workSessions.startedAt, todayStart),
        inArray(workSessions.trigger, ["scheduled", "report"]),
        ne(workSessions.status, "skipped"),
        whose,
      ),
    );
  const todayCount = Number(todayRows[0]?.n ?? 0);
  if (todayCount >= settings.maxSessionsPerDay) {
    return { allowed: false, reason: `daily cap reached (${todayCount}/${settings.maxSessionsPerDay} of their sessions today)` };
  }

  const lastScheduled = await db
    .select()
    .from(workSessions)
    .where(and(inArray(workSessions.trigger, ["scheduled", "report"]), ne(workSessions.status, "skipped"), whose))
    .orderBy(desc(workSessions.startedAt))
    .limit(1);
  if (lastScheduled.length) {
    const elapsedMin = (Date.now() - lastScheduled[0].startedAt.getTime()) / 60_000;
    if (elapsedMin < settings.minGapMinutes) {
      return {
        allowed: false,
        reason: `cooldown active (${Math.round(elapsedMin)}m since last session; need ${settings.minGapMinutes}m)`,
      };
    }
  }
  return { allowed: true };
}
