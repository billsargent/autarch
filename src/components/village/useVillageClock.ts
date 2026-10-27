"use client";

import { useEffect, useState } from "react";
import { clockText, dayPhase, isNight, type DayPhase } from "@/lib/agent/daynight";
import { villageDate, villageHours, type VillageClock } from "@/lib/agent/villageClock";

// The village clock (#100, #150): the village's own time (or the owner's),
// ticking every few seconds, and where that falls between wake-up and bedtime.
export function useVillageClock(bedtime: string, wakeTime: string, clock: VillageClock = "real", dayHours = 4, tickMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  const date = villageDate(new Date(now), clock, dayHours);
  const hours = villageHours(clock, bedtime, wakeTime);
  const phase: DayPhase = dayPhase(date, hours.bedtime, hours.wakeTime);
  return { now, time: clockText(date), phase, night: isNight(date, hours.bedtime, hours.wakeTime) };
}
