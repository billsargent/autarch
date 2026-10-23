// The Mayor's own tools (#58, docs/town-charter.md section 3). Nobody else is
// ever given them, whatever their tool list says. Kept apart from tools.ts so
// the browser can use the list too.
export const MAYOR_TOOLS = ["assign_goal", "schedule_job_for", "review_agent", "flag", "pause_agent", "resume_agent"];

export const isMayorTool = (name: string) => MAYOR_TOOLS.includes(name);
