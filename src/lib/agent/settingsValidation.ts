import os from "node:os";
import { parseHM } from "./daynight";
import path from "node:path";
import { PROJECT_ROOT } from "./config";

// Server-side checks for PUT /api/settings (#11). Every field has a type and a
// range or allowed values, and the workspace must be a sensible folder: a
// workspace of "/" would make every file write count as "inside the
// workspace" and therefore low risk.

type Rule =
  | { kind: "int"; min: number; max: number }
  | { kind: "number"; min: number; max: number; nullable?: boolean }
  | { kind: "bool" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "text"; max: number; nullable?: boolean; min?: number }
  | { kind: "url" }
  | { kind: "tools" }
  | { kind: "paths" }
  | { kind: "workspace" }
  | { kind: "time" }
  | { kind: "future"; maxDays: number };

const RULES: Record<string, Rule> = {
  autonomyMode: { kind: "enum", values: ["manual", "balanced", "autonomous", "unrestricted"] },
  chatMode: { kind: "enum", values: ["agentic", "conversation"] },
  reasoningEffort: { kind: "enum", values: ["low", "high", "max"] },
  modelName: { kind: "text", min: 1, max: 200 },
  agentName: { kind: "text", min: 1, max: 40 },
  apiKey: { kind: "text", max: 500, nullable: true },
  apiBaseUrl: { kind: "url" },
  systemPromptExtra: { kind: "text", max: 20000, nullable: true },
  staticCorePrompt: { kind: "text", max: 20000, nullable: true },
  persona: { kind: "text", max: 4000, nullable: true },
  workWindowPrompt: { kind: "text", max: 20000, nullable: true },
  focusedChatPrompt: { kind: "text", max: 20000, nullable: true },
  truncationMessage: { kind: "text", max: 5000, nullable: true },
  workspaceDir: { kind: "workspace" },
  enabledTools: { kind: "tools" },
  extraProtectedPaths: { kind: "paths" },
  maxAgentSteps: { kind: "int", min: 1, max: 200 },
  maxActionsPerHour: { kind: "int", min: 1, max: 10000 },
  commandTimeoutSec: { kind: "int", min: 1, max: 3600 },
  toolRetries: { kind: "int", min: 0, max: 5 },
  minGapMinutes: { kind: "int", min: 0, max: 1440 },
  maxSessionsPerDay: { kind: "int", min: 1, max: 1000 },
  maxSessionMinutes: { kind: "int", min: 1, max: 720 },
  maxContextTokens: { kind: "int", min: 2000, max: 2_000_000 },
  compactTargetTokens: { kind: "int", min: 500, max: 2_000_000 },
  maxOutputTokens: { kind: "int", min: 64, max: 200_000 },
  inputPricePerMTok: { kind: "number", min: 0, max: 1000 },
  outputPricePerMTok: { kind: "number", min: 0, max: 1000 },
  cacheHitInputPricePerMTok: { kind: "number", min: 0, max: 1000 },
  townDailyBudgetUsd: { kind: "number", min: 0, max: 10000, nullable: true },
  bedtime: { kind: "time" },
  lifeBalance: { kind: "enum", values: ["idle", "hours", "balanced"] },
  workStart: { kind: "time" },
  workEnd: { kind: "time" },
  workShare: { kind: "int", min: 0, max: 100 },
  lifeBudgetUsd: { kind: "number", min: 0, max: 10 },
  hiringMode: { kind: "enum", values: ["ask", "auto"] },
  maxPopulation: { kind: "int", min: 1, max: 50 },
  meetingCostCapUsd: { kind: "number", min: 0.01, max: 100 },
  awayUntil: { kind: "future", maxDays: 60 },
  awaySpendCapUsd: { kind: "number", min: 0, max: 1000 },
  voteCostCapUsd: { kind: "number", min: 0.01, max: 100 },
  calendarIcsUrl: { kind: "text", max: 2000, nullable: true },
  wakeTime: { kind: "time" },
  allowNetworkFetch: { kind: "bool" },
  paused: { kind: "bool" },
  humanAtKeyboard: { kind: "bool" },
  unrestrictedMode: { kind: "bool" },
  allowSecretReads: { kind: "bool" },
  allowFrameworkMutations: { kind: "bool" },
  allowDestructiveShell: { kind: "bool" },
  allowProtectedSystemOps: { kind: "bool" },
  autoCompact: { kind: "bool" },
  thinkingEnabled: { kind: "bool" },
};

// Folders the workspace may not be inside (system code and kernel views).
const FORBIDDEN_PARENTS = ["/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/boot", "/sys", "/proc", "/dev"];
// Folders the workspace may not *be* (it can live below them).
const FORBIDDEN_EXACT = ["/root", "/home", "/var", "/opt", "/srv", "/tmp", "/mnt", "/media"];

export function workspaceProblem(dir: string, projectRoot = PROJECT_ROOT, home = os.homedir()): string | null {
  if (!dir.trim()) return "The workspace folder can't be empty.";
  // Paths written Linux-style are checked with Linux rules on every OS (the
  // agent runs on Linux; this keeps the checks testable elsewhere).
  const P = dir.startsWith("/") ? path.posix : path;
  const within = (parent: string, child: string) => {
    const rel = P.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !P.isAbsolute(rel));
  };
  if (!P.isAbsolute(dir)) return "The workspace folder must be an absolute path.";
  const p = P.resolve(dir);
  if (P.parse(p).root === p) return "The workspace can't be the root of the filesystem.";
  const posix = p.split(P.sep).join("/");
  if (FORBIDDEN_PARENTS.some((f) => posix === f || posix.startsWith(`${f}/`))) return `The workspace can't be inside ${posix.split("/").slice(0, 2).join("/")}.`;
  if (FORBIDDEN_EXACT.includes(posix)) return `The workspace can't be ${posix} itself; use a folder inside it.`;
  if (P.resolve(home) === p) return "The workspace can't be your home folder itself; use a folder inside it.";
  if (within(p, projectRoot)) return "The workspace can't contain the framework's own folder.";
  if (within(projectRoot, p)) return "The workspace can't be inside the framework's own folder.";
  return null;
}

// Returns the cleaned patch, or the first problem found.
export function validateSettingsPatch(
  patch: Record<string, unknown>,
  toolNames: readonly string[],
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const rule = RULES[key];
    if (!rule) continue;
    const fail = (why: string) => ({ ok: false as const, error: `${key}: ${why}` });
    switch (rule.kind) {
      case "int":
      case "number": {
        // An empty optional number (e.g. no town budget) clears it.
        if (rule.kind === "number" && rule.nullable && (value === null || value === "")) {
          clean[key] = null;
          break;
        }
        const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
        if (!Number.isFinite(n)) return fail("must be a number.");
        if (rule.kind === "int" && !Number.isInteger(n)) return fail("must be a whole number.");
        if (n < rule.min || n > rule.max) return fail(`must be between ${rule.min} and ${rule.max}.`);
        clean[key] = n;
        break;
      }
      // A moment in the next few weeks (an ISO date), or null to clear it.
      case "future": {
        if (value === null || value === "") {
          clean[key] = null;
          break;
        }
        const t = typeof value === "string" ? Date.parse(value) : NaN;
        if (!Number.isFinite(t)) return fail("must be a date and time.");
        if (t <= Date.now()) return fail("must be in the future.");
        if (t > Date.now() + rule.maxDays * 86400_000) return fail(`must be within ${rule.maxDays} days.`);
        clean[key] = new Date(t);
        break;
      }
      case "time":
        if (typeof value !== "string" || parseHM(value) === null) return fail("must be a time like 22:00.");
        clean[key] = value.trim().padStart(5, "0");
        break;
      case "bool":
        if (typeof value !== "boolean") return fail("must be true or false.");
        clean[key] = value;
        break;
      case "enum":
        if (typeof value !== "string" || !rule.values.includes(value)) return fail(`must be one of: ${rule.values.join(", ")}.`);
        clean[key] = value;
        break;
      case "text":
        if (value === null || value === "") {
          if (rule.nullable) {
            clean[key] = null;
            break;
          }
          if (rule.min) return fail("can't be empty.");
        }
        if (typeof value !== "string") return fail("must be text.");
        if (value.trim().length < (rule.min ?? 0)) return fail("can't be empty.");
        if (value.length > rule.max) return fail(`must be at most ${rule.max} characters.`);
        clean[key] = rule.min ? value.trim() : value;
        break;
      case "url": {
        let u: URL | null = null;
        try {
          u = typeof value === "string" ? new URL(value) : null;
        } catch {
          u = null;
        }
        if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) return fail("must be an http(s) URL.");
        clean[key] = value;
        break;
      }
      case "tools":
        if (!Array.isArray(value) || value.some((t) => typeof t !== "string")) return fail("must be a list of tool names.");
        {
          const unknown = value.find((t) => !toolNames.includes(t as string));
          if (unknown) return fail(`unknown tool "${unknown}".`);
        }
        clean[key] = [...new Set(value)];
        break;
      case "paths":
        if (!Array.isArray(value) || value.some((p) => typeof p !== "string" || !path.isAbsolute(p))) return fail("must be a list of absolute paths.");
        clean[key] = value;
        break;
      case "workspace": {
        if (typeof value !== "string") return fail("must be a folder path.");
        const problem = workspaceProblem(value);
        if (problem) return fail(problem);
        clean[key] = value.trim();
        break;
      }
    }
  }
  if (typeof clean.compactTargetTokens === "number" && typeof clean.maxContextTokens === "number" && clean.compactTargetTokens >= clean.maxContextTokens) {
    return { ok: false, error: "compactTargetTokens: must be smaller than maxContextTokens." };
  }
  return { ok: true, patch: clean };
}
