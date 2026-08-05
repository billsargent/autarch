import path from "node:path";
import os from "node:os";
import {
  HARD_PROTECTED_PATHS,
  SECRET_PATH_PATTERNS,
  SYSTEM_SENSITIVE_DIRS,
  PROTECTED_PACKAGES,
  PROTECTED_SERVICES,
  PROTECTED_PROCESS_NAMES,
  PROJECT_ROOT,
} from "./config";

export type RiskLevel = "low" | "medium" | "high" | "critical" | "blocked";

export interface RiskResult {
  risk: RiskLevel;
  reason: string;
}

// Human operator "supervisor overrides". When a category is enabled, actions that
// would normally be hard-BLOCKED are downgraded to CRITICAL — which means they still
// require an explicit human approval click before they run. Nothing ever runs
// automatically purely because an override is on.
export interface SuperviseOverrides {
  unrestrictedMode?: boolean;
  allowSecretReads?: boolean;
  allowFrameworkMutations?: boolean;
  allowDestructiveShell?: boolean;
  allowProtectedSystemOps?: boolean;
}

function liftBlock(result: RiskResult, enabled: boolean): RiskResult {
  return enabled
    ? {
        risk: "critical",
        reason: `${result.reason} SUPERVISOR OVERRIDE ENABLED — will run only if the human explicitly approves it.`,
      }
    : result;
}

function anyOverride(overrides: SuperviseOverrides | undefined, keys: (keyof SuperviseOverrides)[]): boolean {
  if (!overrides) return false;
  if (overrides.unrestrictedMode) return true;
  return keys.some((k) => Boolean(overrides[k]));
}

export function buildOverrides(settings: {
  unrestrictedMode?: boolean | null;
  allowSecretReads?: boolean | null;
  allowFrameworkMutations?: boolean | null;
  allowDestructiveShell?: boolean | null;
  allowProtectedSystemOps?: boolean | null;
}): SuperviseOverrides {
  return {
    unrestrictedMode: Boolean(settings.unrestrictedMode),
    allowSecretReads: Boolean(settings.allowSecretReads),
    allowFrameworkMutations: Boolean(settings.allowFrameworkMutations),
    allowDestructiveShell: Boolean(settings.allowDestructiveShell),
    allowProtectedSystemOps: Boolean(settings.allowProtectedSystemOps),
  };
}

function isWithin(parent: string, child: string) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolvePathSafe(input: string, base: string): string {
  if (!input) return base;
  const expanded = input.startsWith("~") ? path.join(os.homedir(), input.slice(1)) : input;
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(base, expanded);
}

export function isHardProtectedPath(target: string, extra: string[] = []): boolean {
  const all = [...HARD_PROTECTED_PATHS, ...extra.map((p) => path.resolve(p))];
  return all.some((p) => isWithin(p, target) || target === p);
}

export function isSecretPath(target: string): boolean {
  return SECRET_PATH_PATTERNS.some((re) => re.test(target));
}

export function classifyFileOperation(
  op: "read" | "write" | "delete" | "list",
  targetPath: string,
  workspaceDir: string,
  extraProtectedPaths: string[] = [],
  overrides?: SuperviseOverrides,
): RiskResult {
  const resolved = resolvePathSafe(targetPath, workspaceDir);

  // Secret paths are checked BEFORE the "read of a hard-protected path is low"
  // rule, so .env / app.db / .ssh etc. can never be read even though some of
  // them are also framework files. (Previously .env was readable because the
  // hard-protected-read branch short-circuited first.)
  if (isSecretPath(resolved)) {
    if (op === "read") {
      return liftBlock(
        {
          risk: "blocked",
          reason: "This path looks like a credential/secret file. Reading secrets is always blocked.",
        },
        anyOverride(overrides, ["allowSecretReads"]),
      );
    }
    // Writing/deleting a secret that is also framework-critical (e.g. .env, app.db)
    // is hard-blocked.
    if (isHardProtectedPath(resolved, extraProtectedPaths)) {
      return liftBlock(
        {
          risk: "blocked",
          reason:
            "This path is a framework-protected secret (e.g. .env, app.db) and can never be modified or deleted.",
        },
        anyOverride(overrides, ["allowFrameworkMutations"]),
      );
    }
    return {
      risk: "critical",
      reason: "This path looks like a credential/secret file. Writing/deleting requires explicit human approval.",
    };
  }

  if (isHardProtectedPath(resolved, extraProtectedPaths) && op !== "read") {
    return liftBlock(
      {
        risk: "blocked",
        reason:
          "This path belongs to the framework's own runtime/dependencies (node_modules, .git, src/db, package.json, etc.) and can never be modified or deleted, even with approval.",
      },
      anyOverride(overrides, ["allowFrameworkMutations"]),
    );
  }
  if (isHardProtectedPath(resolved, extraProtectedPaths) && op === "read") {
    return { risk: "low", reason: "Read-only access to framework source is allowed." };
  }

  // The agent's skills folder lives INSIDE the workspace, so the workspace check
  // below already classifies writes there as low risk.

  if (isWithin(path.resolve(workspaceDir), resolved)) {
    return { risk: "low", reason: "Inside the agent's dedicated sandbox workspace." };
  }

  if (op === "list" || op === "read") {
    return { risk: "low", reason: "Read-only filesystem access." };
  }

  const isSystemDir = SYSTEM_SENSITIVE_DIRS.some((d) => isWithin(d, resolved) || resolved === d);
  if (isSystemDir) {
    return {
      risk: "critical",
      reason: `Writing/deleting under a system directory (${resolved}) requires human approval.`,
    };
  }

  return {
    risk: "high",
    reason: "Writing/deleting outside the sandbox workspace requires human approval.",
  };
}

interface ShellRule {
  test: RegExp;
  risk: RiskLevel;
  reason: string;
}

const BLOCKED_RULES: ShellRule[] = [
  { test: /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+\/\s*($|;|&|\|)/i, risk: "blocked", reason: "Recursive force delete of the root filesystem." },
  { test: /\bmkfs(\.\w+)?\b/i, risk: "blocked", reason: "Formatting a filesystem would destroy data irrecoverably." },
  { test: /\bdd\s+.*of=\/dev\/(sd|nvme|hd|vd|mmcblk)/i, risk: "blocked", reason: "Raw write to a block device can destroy the disk." },
  { test: />\s*\/dev\/(sd|nvme|hd|vd|mmcblk)/i, risk: "blocked", reason: "Raw write to a block device can destroy the disk." },
  { test: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, risk: "blocked", reason: "Fork bomb pattern detected." },
  { test: /\bchmod\s+(-R\s+)?000\s+\/\s*($|;|&)/i, risk: "blocked", reason: "Would lock all permissions on the root filesystem." },
  { test: /\bchmod\s+-R\s+777\s+\/\s*($|;|&)/i, risk: "blocked", reason: "Recursively opening permissions on the whole filesystem." },
  { test: />>?\s*\/etc\/sudoers/i, risk: "blocked", reason: "Direct edits to /etc/sudoers are blocked; use visudo manually outside the agent." },
  { test: /\bkill(all)?\s+.*\b(-9\s+)?1\b/, risk: "blocked", reason: "Killing PID 1 (init) would crash the machine." },
  { test: />\s*\/etc\/passwd|>\s*\/etc\/shadow/i, risk: "blocked", reason: "Overwriting the system auth database." },
  { test: /\bnode_modules\b.*\brm\b|\brm\b.*\bnode_modules\b/i, risk: "blocked", reason: "Deleting node_modules would break this framework's own runtime." },
];

const CRITICAL_RULES: ShellRule[] = [
  { test: /\bsudo\b/i, risk: "critical", reason: "Elevated (sudo) commands always require human approval." },
  { test: /\b(shutdown|poweroff|halt|reboot)\b/i, risk: "critical", reason: "Power state changes require human approval." },
  { test: /\binit\s+[06]\b/i, risk: "critical", reason: "Changing runlevel to halt/reboot requires human approval." },
  { test: /\b(apt(-get)?|dpkg)\s+.*(remove|purge|autoremove)\b/i, risk: "critical", reason: "Removing system packages requires human approval." },
  { test: /\b(kill|pkill|killall)\b/i, risk: "critical", reason: "Terminating processes requires human approval." },
  { test: /\b(useradd|userdel|usermod|passwd)\s/i, risk: "critical", reason: "User account changes require human approval." },
  { test: /\b(iptables|nft|ufw|firewall-cmd)\b/i, risk: "critical", reason: "Firewall/network rule changes require human approval." },
  { test: /\b(mount|umount|fdisk|parted|mkswap|swapon|swapoff)\b/i, risk: "critical", reason: "Disk/mount operations require human approval." },
  { test: /\bchown\s+-R|\bchmod\s+-R/i, risk: "critical", reason: "Recursive ownership/permission changes require human approval." },
  { test: /\bgit\s+push\s+.*--force/i, risk: "critical", reason: "Force-pushing can destroy remote git history." },
  { test: /curl[^|]*\|\s*(sudo\s+)?(bash|sh)\b|wget[^|]*\|\s*(sudo\s+)?(bash|sh)\b/i, risk: "critical", reason: "Piping a remote script directly into a shell requires human approval." },
  { test: /\bcrontab\b/i, risk: "critical", reason: "Modifying scheduled jobs requires human approval." },
  { test: /\bsystemctl\s+(stop|disable|mask)\b/i, risk: "critical", reason: "Stopping/disabling a system service requires human approval." },
];

const HIGH_RULES: ShellRule[] = [
  { test: /\b(apt(-get)?)\s+(install|upgrade|dist-upgrade|full-upgrade)\b/i, risk: "high", reason: "Installing/upgrading system packages requires approval unless autonomy allows it." },
  { test: /\bsystemctl\s+(start|restart|enable|reload)\b/i, risk: "high", reason: "Starting/restarting a system service requires approval unless autonomy allows it." },
  { test: /\bnpm\s+(un)?install\s+-g|\byarn\s+global\b|\bpip3?\s+install\b.*--user\b/i, risk: "high", reason: "Global package installs affect the whole system." },
  { test: /\bdocker\b/i, risk: "high", reason: "Container operations can consume significant resources or change system state." },
];

const MEDIUM_RULES: ShellRule[] = [
  { test: /\b(mkdir|touch|mv|cp|tar|unzip|sed\s+-i)\b/i, risk: "medium", reason: "File-modifying command." },
  { test: /\b(rm|truncate)\b/i, risk: "medium", reason: "Deleting or truncating files." },
  { test: />\s+(?!\/dev\/null\b|&\d)\S/, risk: "medium", reason: "Shell output redirection to a file." },
  { test: /\bnpm\s+(install|ci|run|test|build)\b/i, risk: "medium", reason: "Local project tooling command." },
  { test: /\bpip3?\s+install\b/i, risk: "medium", reason: "Installing a Python package." },
  { test: /\bgit\s+(clone|commit|add|checkout|merge|pull|push|reset)\b/i, risk: "medium", reason: "Git write operation." },
  { test: /\b(curl|wget)\b/i, risk: "medium", reason: "Outbound network request." },
];

const LOW_PREFIXES: RegExp[] = [
  /^\s*(ls|pwd|whoami|id|uname|df|du|free|uptime|date|hostname|cat|head|tail|grep|find|which|env|printenv|echo|ps|top|htop|lscpu|lsblk|lsusb|lspci|node\s+-v|npm\s+-v|python3?\s+-{1,2}v|git\s+(status|log|diff|show|branch)|man|help)\b/i,
];

// Read-capable shell verbs used by the secret exfiltration guard.
const READ_VERB =
  /\b(cat|less|more|head|tail|strings|base64|xxd|od|sed|awk|grep|find|cp|scp|dd|nano|vi|vim|view|openssl|tar|unzip|sort|uniq|wc)\b/i;

// True if the command references a path-like token that matches a secret pattern
// (skipping glob tokens like "*.pem" so discovery commands like `find -name`
// aren't false-positived).
function commandMentionsSecretPath(cmd: string): boolean {
  const tokens = cmd.split(/\s+/);
  for (const raw of tokens) {
    const tok = raw.replace(/^["']+|["']+$/g, "").replace(/[;|&)"'`]+$/g, "");
    if (!tok || tok.includes("*") || tok.includes("?")) continue;
    if (SECRET_PATH_PATTERNS.some((re) => re.test(tok))) return true;
  }
  return false;
}

export function classifyShellCommand(command: string, overrides?: SuperviseOverrides): RiskResult {
  const cmd = command.trim();
  if (!cmd) return { risk: "low", reason: "Empty command." };

  for (const rule of BLOCKED_RULES) {
    if (rule.test.test(cmd)) {
      return liftBlock({ risk: rule.risk, reason: rule.reason }, anyOverride(overrides, ["allowDestructiveShell"]));
    }
  }
  for (const rule of CRITICAL_RULES) {
    if (rule.test.test(cmd)) return { risk: rule.risk, reason: rule.reason };
  }

  // Secret exfiltration guard: reading a credential-looking path through shell
  // tools (cat .env, cat /root/.ssh/id_rsa, ...) is blocked just like the file
  // tools, so a leading safe verb can't smuggle a secret read past the guard.
  if (READ_VERB.test(cmd) && commandMentionsSecretPath(cmd)) {
    return liftBlock(
      { risk: "blocked", reason: "This command reads a path that looks like a credential/secret file." },
      anyOverride(overrides, ["allowSecretReads"]),
    );
  }

  // Protect self-critical paths referenced from arbitrary shell commands.
  const touchesHardProtected = HARD_PROTECTED_PATHS.some((p) => cmd.includes(p)) ||
    HARD_PROTECTED_PATHS.some((p) => cmd.includes(path.relative(PROJECT_ROOT, p)) && path.relative(PROJECT_ROOT, p) !== "");
  const destructiveVerb = /\b(rm|mv|dd|truncate|>|>>|sed\s+-i)\b/i.test(cmd);
  if (touchesHardProtected && destructiveVerb) {
    return liftBlock(
      {
        risk: "blocked",
        reason: "This command references a file/directory the framework depends on to run itself. Blocked unconditionally.",
      },
      anyOverride(overrides, ["allowFrameworkMutations"]),
    );
  }

  for (const rule of HIGH_RULES) {
    if (rule.test.test(cmd)) return { risk: rule.risk, reason: rule.reason };
  }
  for (const rule of MEDIUM_RULES) {
    if (rule.test.test(cmd)) return { risk: rule.risk, reason: rule.reason };
  }
  for (const re of LOW_PREFIXES) {
    if (re.test(cmd)) return { risk: "low", reason: "Read-only / informational command." };
  }

  return { risk: "medium", reason: "Unrecognized command pattern; treated as medium risk by default." };
}

export function classifyPackageAction(
  action: "install" | "remove" | "upgrade" | "search" | "update" | "list",
  packages: string[],
  overrides?: SuperviseOverrides,
): RiskResult {
  if (action === "search" || action === "list") {
    return { risk: "low", reason: "Read-only package query." };
  }
  if (action === "update") {
    return { risk: "medium", reason: "Refreshing the apt package index (network + writes /var/lib/apt)." };
  }
  if (action === "remove") {
    const hitsProtected = packages.some((p) => PROTECTED_PACKAGES.includes(p.toLowerCase()));
    if (hitsProtected) {
      return liftBlock(
        {
          risk: "blocked",
          reason: "One or more of these packages are protected core dependencies (Node/Postgres/OS core) and can never be removed.",
        },
        anyOverride(overrides, ["allowProtectedSystemOps"]),
      );
    }
    return { risk: "critical", reason: "Removing any system package requires explicit human approval." };
  }
  return { risk: "high", reason: "Installing/upgrading system packages requires approval unless autonomy allows it." };
}

export function classifyServiceAction(
  action: "start" | "stop" | "restart" | "enable" | "disable" | "status",
  service: string,
  overrides?: SuperviseOverrides,
): RiskResult {
  const isProtected = PROTECTED_SERVICES.some((s) =>
    s.endsWith("*") ? service.startsWith(s.slice(0, -1)) : s === service,
  );
  if (action === "status") return { risk: "low", reason: "Read-only service status check." };
  if (isProtected && (action === "stop" || action === "disable")) {
    return liftBlock(
      {
        risk: "blocked",
        reason: `${service} is a protected service this framework depends on (e.g. its database). Stopping/disabling it is blocked.`,
      },
      anyOverride(overrides, ["allowProtectedSystemOps"]),
    );
  }
  if (isProtected) {
    return { risk: "critical", reason: `${service} is protected; this action requires explicit human approval.` };
  }
  if (action === "stop" || action === "disable") {
    return { risk: "critical", reason: "Stopping/disabling a service requires human approval." };
  }
  return { risk: "high", reason: "Starting/restarting/enabling a service requires approval unless autonomy allows it." };
}

export function classifyProcessTarget(target: string, overrides?: SuperviseOverrides): RiskResult {
  const lower = target.toLowerCase();
  const hitsProtected = PROTECTED_PROCESS_NAMES.some((p) => lower.includes(p));
  if (hitsProtected) {
    return liftBlock(
      {
        risk: "blocked",
        reason: "Refusing to signal a process that matches this framework's own runtime (node/postgres/npm).",
      },
      anyOverride(overrides, ["allowProtectedSystemOps"]),
    );
  }
  return { risk: "critical", reason: "Terminating a process requires human approval." };
}

export function classifyFetchUrl(url: string): RiskResult {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) || host.endsWith(".local")) {
      return { risk: "blocked", reason: "Fetching the framework's own host is blocked to avoid feedback loops." };
    }
    if (u.protocol === "file:") {
      return { risk: "blocked", reason: "file:// URLs are blocked." };
    }
    return { risk: "medium", reason: "Outbound network request." };
  } catch {
    return { risk: "blocked", reason: "Invalid URL." };
  }
}

export function autonomyAllowsAuto(
  mode: "manual" | "balanced" | "autonomous" | "unrestricted",
  risk: RiskLevel,
): boolean {
  if (mode === "unrestricted") return true; // unrestricted: everything auto-runs, no approvals
  if (risk === "blocked") return false;
  if (risk === "critical") return false; // critical always needs a human, no matter the mode
  if (risk === "low") return true;
  if (risk === "medium") return mode === "balanced" || mode === "autonomous";
  if (risk === "high") return mode === "autonomous";
  return false;
}
