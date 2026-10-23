// What a villager is doing, derived from the agent's real state, and where in
// the village that puts them. Pure: no React, no DOM.

export type Mood = "working" | "waiting" | "idle" | "asleep";

export interface AgentSnapshot {
  paused: boolean;
  running: boolean;
  pendingApprovals: number;
  // Night by the village clock (#100).
  night?: boolean;
}

// Precedence: a paused village sleeps no matter what; a pending approval
// outranks work because the agent is blocked on the human. At night a
// villager sleeps unless the human has them awake (talking, or waiting on an
// answer).
export function villagerMood(s: AgentSnapshot): Mood {
  if (s.paused) return "asleep";
  if (s.night && !s.running && !s.pendingApprovals) return "asleep";
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
      return `${name} is asleep at home`;
    default:
      return `${name} is relaxing at home`;
  }
}

// Sideways offsets (scene px) so villagers headed for the same spot stand side
// by side instead of on top of each other: [0], [-28, 28], [-56, 0, 56], …
export function standOffsets(targets: string[], gap = 56): number[] {
  const groups = new Map<string, number[]>();
  targets.forEach((t, i) => groups.set(t, [...(groups.get(t) ?? []), i]));
  const out = targets.map(() => 0);
  for (const idx of groups.values()) idx.forEach((i, k) => (out[i] = (k - (idx.length - 1) / 2) * gap));
  return out;
}

export const MOOD_BADGE: Record<Mood, string> = {
  working: "🔨",
  waiting: "❗",
  idle: "☕",
  asleep: "💤",
};

// --- speech bubbles ---------------------------------------------------------------

// How long a reply stays in the villager's speech bubble after it was said.
export const BUBBLE_MS = 30_000;

// What a villager says out loud: the first sentence of their last reply, as
// plain words. Code, tables and lists aren't the kind of thing you say across
// the village square, so they're left out; if nothing sayable is left, no bubble.
export function bubbleLine(text: string, max = 80): string | null {
  const prose = text
    .replace(/```[\s\S]*?```/g, " ") // code blocks
    .split("\n")
    .filter((l) => !/^\s*(\||[-*+] |\d+\. |#|>|<)/.test(l)) // tables, lists, headings, quotes, html
    .join(" ")
    .replace(/`[^`]*`/g, "") // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images → their text
    .replace(/[*_~#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!prose) return null;
  const first = prose.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? prose;
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length)}…`;
}
