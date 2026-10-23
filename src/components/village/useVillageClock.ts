"use client";

import { useEffect, useState } from "react";
import { clockText, dayPhase, isNight, type DayPhase } from "@/lib/agent/daynight";

// The village clock (#100): the local time, ticking every few seconds, and
// where that falls between wake-up and bedtime.
export function useVillageClock(bedtime: string, wakeTime: string, tickMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  const date = new Date(now);
  const phase: DayPhase = dayPhase(date, bedtime, wakeTime);
  return { now, time: clockText(date), phase, night: isNight(date, bedtime, wakeTime) };
}
