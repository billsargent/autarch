// What starts a turn: the one list (schema, runner, turn lock, prompt and the
// browser all use it). Add a new kind of turn here only.
export const SESSION_TRIGGERS = ["chat", "approval", "scheduled", "report", "message", "interview", "meeting", "review", "vote", "life"] as const;

export type SessionTrigger = (typeof SESSION_TRIGGERS)[number];

// Talk-only turns: one model call, no tools (#81, #98, #99, #102).
export const TALK_ONLY_TRIGGERS: readonly SessionTrigger[] = ["interview", "meeting", "review", "vote"];

// A villager's own time in the village (#133): only the life tools, a few steps.
export const LIFE_STEPS = 4;
