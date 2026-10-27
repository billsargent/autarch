import type { ToolContext } from "./tools";

// The research desk's own tools (#170): only offered in a research turn,
// alongside web_search and fetch_url (RESEARCH_TOOL_NAMES). Like the life
// tools, they never appear among the general tools.

type Result = { output: string; summary: string };
interface ResearchTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  risk: { risk: "low"; reason: string };
  run: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<Result>;
}

export const RESEARCH_TOOLS: Record<string, ResearchTool> = {
  research_plan: {
    definition: {
      type: "function",
      function: {
        name: "research_plan",
        description: "Lead only, while planning: the questions that together cover the topic, each given to someone on the team by name.",
        parameters: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: { type: "object", properties: { question: { type: "string" }, assignee: { type: "string", description: "A team member's name." } }, required: ["question", "assignee"] },
            },
          },
          required: ["questions"],
        },
      },
    },
    risk: { risk: "low", reason: "Plans a research project; no effect on the computer." },
    run: async (args, ctx) => (await import("./research")).researchPlanTool(args, ctx),
  },
  research_note: {
    definition: {
      type: "function",
      function: {
        name: "research_note",
        description: "Record one finding for your question, in your own words, with the address and title of the source it came from.",
        parameters: {
          type: "object",
          properties: {
            finding: { type: "string" },
            url: { type: "string", description: "The source's address (http or https)." },
            title: { type: "string", description: "The source's title or site name." },
          },
          required: ["finding", "url"],
        },
      },
    },
    risk: { risk: "low", reason: "Records a research finding; no effect on the computer." },
    run: async (args, ctx) => (await import("./research")).researchNoteTool(args, ctx),
  },
  research_write: {
    definition: {
      type: "function",
      function: {
        name: "research_write",
        description: "Lead only, at the end: the report in markdown, citing sources by number like [2]. The sources list is added for you.",
        parameters: {
          type: "object",
          properties: { title: { type: "string" }, report: { type: "string" } },
          required: ["report"],
        },
      },
    },
    risk: { risk: "low", reason: "Puts a research report on the library's shelf." },
    run: async (args, ctx) => (await import("./research")).researchWriteTool(args, ctx),
  },
};

// What a research turn may use: searching, reading pages, and the desk's tools.
export const RESEARCH_TOOL_NAMES = [...Object.keys(RESEARCH_TOOLS), "web_search", "fetch_url"];
