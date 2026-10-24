// The Mayor's own tools (#58, docs/town-charter.md section 3). Nobody else is
// ever given them, whatever their tool list says. Kept apart from tools.ts so
// the browser can use the list too.
export const MAYOR_TOOLS = ["assign_goal", "schedule_job_for", "review_agent", "flag", "pause_agent", "resume_agent", "call_meeting"];

export const isMayorTool = (name: string) => MAYOR_TOOLS.includes(name);

// Tools for those who may take people on (#99): the Mayor and directors.
// Workers never get them.
export const HIRING_TOOLS = ["propose_hire"];

export type Tier = "mayor" | "director" | "worker";

// Whether a villager of this rank may ever have this tool.
export function tierAllows(tier: Tier, tool: string): boolean {
  if (isMayorTool(tool)) return tier === "mayor";
  if (HIRING_TOOLS.includes(tool)) return tier !== "worker";
  return true;
}
