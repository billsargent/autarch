// What a villager is doing, derived from the agent's real state, and where in
// the village that puts them. Pure: no React, no DOM.

export type Mood = "working" | "waiting" | "idle" | "asleep";

export interface AgentSnapshot {
  paused: boolean;
  running: boolean;
  pendingApprovals: number;
}

// Precedence: a paused village sleeps no matter what; a pending approval
// outranks work because the agent is blocked on the human.
export function villagerMood(s: AgentSnapshot): Mood {
  if (s.paused) return "asleep";
  if (s.pendingApprovals > 0) return "waiting";
  if (s.running) return "working";
  return "idle";
}

// Building id (see manifest.ts) each mood sends the villager to.
export const MOOD_PLACE: Record<Mood, string> = {
  working: "workshop",
  waiting: "townhall",
  idle: "cottages",
  asleep: "cottages",
};

// Where an idle villager strolls next: any hangout except the one it's at.
// `rand` is in [0, 1) so callers (and tests) control the randomness.
export function nextHangout(current: string | null, hangouts: string[], rand: number): string | null {
  const choices = hangouts.filter((h) => h !== current);
  if (!choices.length) return current;
  return choices[Math.min(choices.length - 1, Math.floor(rand * choices.length))];
}

// `strolling`: an idle villager that's out walking rather than at home.
export function moodLabel(mood: Mood, name: string, strolling = false): string {
  if (mood === "idle" && strolling) return `${name} is out for a stroll`;
  switch (mood) {
    case "working":
      return `${name} is tinkering in the workshop`;
    case "waiting":
      return `${name} is waiting at the town hall for your okay`;
    case "asleep":
      return `${name} is asleep — the village is paused`;
    default:
      return `${name} is relaxing at home`;
  }
}

export const MOOD_BADGE: Record<Mood, string> = {
  working: "🔨",
  waiting: "❗",
  idle: "☕",
  asleep: "💤",
};
