// Limits shared by the server and the browser. No imports, so client
// components can use these without pulling in server-only modules.

// How many characters of each skill file are injected into the agent's system
// prompt. Longer skills are cut off at this point.
export const SKILL_PROMPT_CHARS = 2000;

// How many skill files reach the prompt (alphabetical by file name).
export const SKILLS_IN_PROMPT = 8;
