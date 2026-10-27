// What starts a turn: the one list (schema, runner, turn lock, prompt and the
// browser all use it). Add a new kind of turn here only.
export const SESSION_TRIGGERS = ["chat", "approval", "scheduled", "report", "message", "interview", "meeting", "review", "vote", "life", "research"] as const;

export type SessionTrigger = (typeof SESSION_TRIGGERS)[number];

// Talk-only turns: one model call, no tools (#81, #98, #99, #102).
export const TALK_ONLY_TRIGGERS: readonly SessionTrigger[] = ["interview", "meeting", "review", "vote"];

// Village talk (#152): with "thinking for work only", these turns (and a
// plain chat with no tools) answer straight, without thinking, at the talk
// temperature. A villager's message to a neighbour is talk too.
export const TALK_TRIGGERS: readonly SessionTrigger[] = [...TALK_ONLY_TRIGGERS, "life", "message"];

// Is this turn village talk, not work?
export function isTalkTurn(trigger: SessionTrigger, toolsAvailable: boolean): boolean {
  return TALK_TRIGGERS.includes(trigger) || !toolsAvailable;
}

// A villager's own time in the village (#133): only the life tools, a few steps.
export const LIFE_STEPS = 4;
