import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { gitBashPath } from "./host";
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
  // On Windows, a Git Bash path (/d/root/x) means drive D: (#150), the way
  // villagers write paths in their commands.
  const native = process.platform === "win32" ? input.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:") : input;
  const expanded = native.startsWith("~") ? path.join(os.homedir(), native.slice(1)) : native;
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(base, expanded);
}

// The real location of a path, following symlinks (and junctions). For a path
// that doesn't exist yet (a file about to be written), the nearest existing
// parent is resolved and the rest appended. Path checks use this so a link in
// the workspace can't point the agent at a secret or protected file (#9).
export function realPath(p: string): string {
  let current = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function isHardProtectedPath(target: string, extra: string[] = []): boolean {
  const all = [...HARD_PROTECTED_PATHS, ...extra.map((p) => path.resolve(p))];
  const real = realPath(target);
  return all.some((p) => isWithin(p, target) || isWithin(realPath(p), real));
}

export function isSecretPath(target: string): boolean {
  // Patterns use forward slashes (".ssh/"); normalise Windows separators too.
  const forms = [target, realPath(target)].flatMap((p) => [p, p.replace(/\\/g, "/")]);
  return SECRET_PATH_PATTERNS.some((re) => forms.some((f) => re.test(f)));
}

// True if `target` really lives inside `dir` once symlinks are followed.
export function isReallyWithin(dir: string, target: string): boolean {
  return isWithin(realPath(dir), realPath(target));
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

  // Judged on the real location, so a link inside the workspace pointing
  // elsewhere doesn't count as "inside the workspace".
  if (isReallyWithin(workspaceDir, resolved)) {
    return { risk: "low", reason: "Inside the agent's dedicated sandbox workspace." };
  }

  if (op === "list" || op === "read") {
    return { risk: "low", reason: "Read-only filesystem access." };
  }

  const real = realPath(resolved);
  const isSystemDir = SYSTEM_SENSITIVE_DIRS.some((d) => isWithin(d, resolved) || isWithin(d, real));
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
  // Windows (PowerShell, cmd and Git Bash).
  { test: /\b(Format-Volume|Clear-Disk|Initialize-Disk|diskpart)\b|\bformat(\.com)?\s+[a-z]:/i, risk: "blocked", reason: "Formatting or wiping a disk would destroy data irrecoverably." },
  // A recursive delete anywhere in the command, and a bare drive (C:\, C:\*)
  // anywhere in it, in any order: `Remove-Item C:\ -Recurse`, `gci C:\ | ri -r`.
  {
    test: /^(?=[\s\S]*\b(Remove-Item|ri|del|erase|rd|rmdir)\b)(?=[\s\S]*\s(-r\w*|\/s)\b)(?=[\s\S]*(^|[\s=:,])["']?[a-z]:[\\/]?\*?["']?(\s|$|;|&|\|))/i,
    risk: "blocked",
    reason: "Recursive delete of a whole drive.",
  },
  // Git Bash's drives are /c, /d …: `rm -rf /c`. (Only with rm, so a cmd
  // switch like `/q` is never taken for a drive.)
  {
    test: /^(?=[\s\S]*\brm\b)(?=[\s\S]*\s-\w*r)(?=[\s\S]*\s["']?\/[a-z]\/?\*?["']?(\s|$|;|&|\|))/i,
    risk: "blocked",
    reason: "Recursive delete of a whole drive.",
  },
  { test: /\b(Remove-Item|ri|del|erase|rd|rmdir)\b.*\bnode_modules\b/i, risk: "blocked", reason: "Deleting node_modules would break this framework's own runtime." },
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
  // Windows equivalents.
  { test: /\bStart-Process\b.*-Verb\s+RunAs\b|\brunas\b/i, risk: "critical", reason: "Running as administrator always requires human approval." },
  { test: /\b(Restart-Computer|Stop-Computer)\b/i, risk: "critical", reason: "Power state changes require human approval." },
  { test: /\b(Stop-Process|spps|taskkill)\b/i, risk: "critical", reason: "Terminating processes requires human approval." },
  {
    test: /\b(Stop-Service|Remove-Service|Suspend-Service)\b|\bSet-Service\b.*\b(Disabled|Stopped)\b|\bsc(\.exe)?\s+(stop|delete|config)\b|\bnet\s+stop\b/i,
    risk: "critical",
    reason: "Stopping/disabling a system service requires human approval.",
  },
  { test: /\b(winget|choco|scoop)\s+(uninstall|remove)\b|\b(Uninstall-Package|Remove-AppxPackage|Uninstall-Module)\b/i, risk: "critical", reason: "Removing software requires human approval." },
  {
    test: /\b(New-LocalUser|Remove-LocalUser|Set-LocalUser|Add-LocalGroupMember|Remove-LocalGroupMember)\b|\bnet\s+(user|localgroup)\b.*\s\/(add|delete)\b/i,
    risk: "critical",
    reason: "User account changes require human approval.",
  },
  {
    test: /\b(netsh|New-NetFirewallRule|Set-NetFirewallRule|Remove-NetFirewallRule|Set-NetFirewallProfile|Disable-NetFirewallRule)\b/i,
    risk: "critical",
    reason: "Firewall/network rule changes require human approval.",
  },
  { test: /\b(schtasks|Register-ScheduledTask|Unregister-ScheduledTask|Set-ScheduledTask)\b/i, risk: "critical", reason: "Modifying scheduled tasks requires human approval." },
  {
    test: /\breg(\.exe)?\s+(add|delete|import|load|restore)\b|\b(Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|Remove-Item)\b.*\bHK(LM|CU|CR|U|CC)\b|\bRegistry::/i,
    risk: "critical",
    reason: "Changing the Windows registry requires human approval.",
  },
  {
    test: /\b(Set-ExecutionPolicy|bcdedit|Set-MpPreference|Add-MpPreference|Disable-WindowsOptionalFeature|Enable-WindowsOptionalFeature|Disable-ComputerRestore)\b/i,
    risk: "critical",
    reason: "System security or boot settings require human approval.",
  },
  { test: /\b(takeown|icacls)\b.*\/(grant|setowner|reset|remove)|\bSet-Acl\b/i, risk: "critical", reason: "Ownership/permission changes require human approval." },
  {
    test: /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(iex|Invoke-Expression)\b|\b(iex|Invoke-Expression)\b.*\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b/i,
    risk: "critical",
    reason: "Running a downloaded script directly requires human approval.",
  },
];

const HIGH_RULES: ShellRule[] = [
  { test: /\b(apt(-get)?)\s+(install|upgrade|dist-upgrade|full-upgrade)\b/i, risk: "high", reason: "Installing/upgrading system packages requires approval unless autonomy allows it." },
  { test: /\bsystemctl\s+(start|restart|enable|reload)\b/i, risk: "high", reason: "Starting/restarting a system service requires approval unless autonomy allows it." },
  { test: /\bnpm\s+(un)?install\s+-g|\byarn\s+global\b|\bpip3?\s+install\b.*--user\b/i, risk: "high", reason: "Global package installs affect the whole system." },
  { test: /\bdocker\b/i, risk: "high", reason: "Container operations can consume significant resources or change system state." },
  { test: /\b(winget|choco|scoop)\s+(install|upgrade|update)\b|\b(Install-Package|Install-Module|Update-Module)\b/i, risk: "high", reason: "Installing/upgrading software requires approval unless autonomy allows it." },
  { test: /\b(Start-Service|Restart-Service|Set-Service)\b|\bsc(\.exe)?\s+start\b|\bnet\s+start\b/i, risk: "high", reason: "Starting/restarting a system service requires approval unless autonomy allows it." },
];

const MEDIUM_RULES: ShellRule[] = [
  { test: /\b(mkdir|touch|mv|cp|tar|unzip|sed\s+-i)\b/i, risk: "medium", reason: "File-modifying command." },
  { test: /\b(rm|truncate)\b/i, risk: "medium", reason: "Deleting or truncating files." },
  { test: />\s+(?!\/dev\/null\b|&\d)\S/, risk: "medium", reason: "Shell output redirection to a file." },
  { test: /\bnpm\s+(install|ci|run|test|build)\b/i, risk: "medium", reason: "Local project tooling command." },
  { test: /\bpip3?\s+install\b/i, risk: "medium", reason: "Installing a Python package." },
  { test: /\bgit\s+(clone|commit|add|checkout|merge|pull|push|reset)\b/i, risk: "medium", reason: "Git write operation." },
  { test: /\b(curl|wget)\b/i, risk: "medium", reason: "Outbound network request." },
  // PowerShell's full names anywhere; short aliases and cmd verbs (which are
  // also ordinary words) only where a command starts.
  {
    test: /\b(New-Item|Copy-Item|Move-Item|Rename-Item|Set-Content|Add-Content|Out-File|Expand-Archive|Compress-Archive|xcopy|robocopy)\b|(^|[;&|]\s*)(ni|cpi|mi|copy|move|ren|md)\s/i,
    risk: "medium",
    reason: "File-modifying command.",
  },
  { test: /\b(Remove-Item|Clear-Content)\b|(^|[;&|]\s*)(ri|del|erase|rd)\s/i, risk: "medium", reason: "Deleting files." },
  { test: /\b(Invoke-WebRequest|iwr|Invoke-RestMethod|irm|Start-BitsTransfer)\b/i, risk: "medium", reason: "Outbound network request." },
  // Running code on what a read-only command finds (`Get-Process | % { $_.Kill() }`,
  // `find . -delete`) isn't read-only, however the command starts.
  {
    test: /\b(ForEach-Object|Invoke-Expression|iex|Invoke-Command|Invoke-Item)\b|\|\s*%\s*\{|\$_\.\w+\s*\(|\[[\w.]+\]::\w+\s*\(|\bfind\b.*\s-(delete|exec|execdir|ok)\b|\bxargs\b/i,
    risk: "medium",
    reason: "Runs code or commands on what it finds.",
  },
];

const LOW_PREFIXES: RegExp[] = [
  /^\s*(ls|pwd|whoami|id|uname|df|du|free|uptime|date|hostname|cat|head|tail|grep|find|which|env|printenv|echo|ps|top|htop|lscpu|lsblk|lsusb|lspci|node\s+-v|npm\s+-v|python3?\s+-{1,2}v|git\s+(status|log|diff|show|branch)|man|help)\b/i,
  // Windows: PowerShell's Get-* and the read-only cmd tools.
  /^\s*(dir|type|Get-[A-Za-z]+|gci|gc|Select-String|sls|Test-Path|Resolve-Path|Measure-Object|systeminfo|ver|tasklist|where(\.exe)?|ipconfig|winget\s+(list|search|show))\b/i,
];

// Read-capable shell verbs used by the secret exfiltration guard.
const READ_VERB =
  /\b(cat|less|more|head|tail|strings|base64|xxd|od|sed|awk|grep|find|cp|scp|dd|nano|vi|vim|view|openssl|tar|unzip|sort|uniq|wc|type|Get-Content|gc|Select-String|sls|Copy-Item|cpi|copy|xcopy|robocopy|notepad|certutil|Compress-Archive)\b/i;

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

  // Talking to the dashboard's own control API from the shell (it could
  // approve its own actions or change settings) is blocked, override or not (#4).
  const dashboardPort = process.env.PORT || "3000";
  if (/\/api\/(approvals|settings|chat|auth|conversations)\b/i.test(cmd)) {
    return { risk: "blocked", reason: "Commands that call the dashboard's control API are blocked." };
  }
  if (new RegExp(`(localhost|127\\.\\d+\\.\\d+\\.\\d+|0\\.0\\.0\\.0|\\[?::1\\]?|\\[?::ffff:[0-9a-f.:]+\\]?)(:${dashboardPort})\\b`, "i").test(cmd)) {
    return { risk: "blocked", reason: "Commands that connect to the dashboard on this machine are blocked." };
  }

  // `powershell -Command "…"` and `cmd /c …` are judged by the command inside
  // them, so a wrapped Get-ChildItem is as low as a bare one and a wrapped
  // Stop-Process as critical. A command that can't be read can't be judged.
  if (/^\s*(powershell|pwsh)(\.exe)?\b[^|;&]*\s-(e|ec|enc|encodedcommand)\s/i.test(cmd)) {
    return { risk: "critical", reason: "An encoded PowerShell command hides what it runs; it needs human approval." };
  }
  const wrapped =
    /^\s*(?:powershell|pwsh)(?:\.exe)?(?:\s+-(?!c\b|command\b)\w+(?:\s+(?!-)[\w.]+)?)*\s+-(?:c|command)\s+([\s\S]+)$/i.exec(cmd) ??
    /^\s*cmd(?:\.exe)?\s+\/[ck]\s+([\s\S]+)$/i.exec(cmd);
  if (wrapped) {
    const inner = wrapped[1].trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
    if (inner && inner !== cmd) return classifyShellCommand(inner, overrides);
  }

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
  // Absolute protected paths anywhere in the command, or relative names (src,
  // package.json, src/db...) as whole path tokens — not as substrings, so
  // "/tmp/mysrc" doesn't match "src".
  const tokens = cmd.split(/[\s;|&()<>"'`]+/).filter(Boolean);
  // On Windows an absolute path can be written D:\x, D:/x or (Git Bash) /d/x,
  // in any case.
  const win = process.platform === "win32";
  const pathForms = (p: string) => (win ? [p, p.replace(/\\/g, "/"), gitBashPath(p)].map((f) => f.toLowerCase()) : [p]);
  const cmdForm = win ? cmd.toLowerCase() : cmd;
  const touchesHardProtected =
    HARD_PROTECTED_PATHS.some((p) => pathForms(p).some((f) => cmdForm.includes(f))) ||
    HARD_PROTECTED_PATHS.some((p) => {
      const rel = path.relative(PROJECT_ROOT, p).split(path.sep).join("/");
      if (!rel) return false;
      return tokens.some((t) => {
        const tok = t.replace(/^\.\//, "").replace(/\/+$/, "");
        return tok === rel || tok.startsWith(`${rel}/`);
      });
    });
  // Short cmd verbs and aliases (del, move, ren …) are also ordinary words, so
  // they only count where a command starts.
  const destructiveVerb =
    /\b(rm|mv|dd|truncate|>|>>|sed\s+-i|Remove-Item|rmdir|Move-Item|Set-Content|Out-File|Clear-Content|Rename-Item)\b|(^|[;&|]\s*)(ri|mi|del|erase|rd|move|ren)\s/i.test(cmd);
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

// Package and service names are checked against their real naming rules
// before anything runs, and the commands run without a shell, so a name can
// never smuggle in a command (#2).
// Debian package names (lowercase letters, digits, + - .), optional :arch.
export const PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]*(:[a-z0-9]+)?$/;
// apt-cache search terms: plain words only.
export const PACKAGE_SEARCH = /^[A-Za-z0-9+._ -]{1,64}$/;
// systemd unit names (letters, digits, : _ . @ -).
export const UNIT_NAME = /^[A-Za-z0-9:_.@-]{1,128}$/;

export function invalidPackageArgs(
  action: "install" | "remove" | "upgrade" | "search" | "update" | "list",
  packages: unknown,
): string | null {
  if (packages !== undefined && !Array.isArray(packages)) return "packages must be a list of names.";
  const list = (packages as unknown[] | undefined) ?? [];
  if (list.some((p) => typeof p !== "string")) return "packages must be a list of names.";
  if (action === "search") {
    const q = (list as string[]).join(" ");
    return q && !PACKAGE_SEARCH.test(q) ? `Invalid search term "${q}" (letters, digits, + . _ - and spaces only).` : null;
  }
  const bad = (list as string[]).find((p) => !PACKAGE_NAME.test(p));
  return bad !== undefined ? `Invalid package name "${bad}".` : null;
}

export function classifyPackageAction(
  action: "install" | "remove" | "upgrade" | "search" | "update" | "list",
  packages: string[],
  overrides?: SuperviseOverrides,
): RiskResult {
  const invalid = invalidPackageArgs(action, packages);
  if (invalid) return { risk: "blocked", reason: invalid };
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
  if (!UNIT_NAME.test(service)) return { risk: "blocked", reason: `Invalid service name "${service}".` };
  if (!["start", "stop", "restart", "enable", "disable", "status"].includes(action)) {
    return { risk: "blocked", reason: `Unknown service action "${action}".` };
  }
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

// --- Network destinations (#4) ----------------------------------------------
// The agent must not reach this machine's own services (above all the
// dashboard's control API, where it could approve its own actions), and
// reaching other machines on the local network needs the human's approval.

type AddressKind = "self" | "private" | "public";

function ipv4Kind(ip: string): AddressKind | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 0) return "self";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) {
    return "private";
  }
  return "public";
}

function ownAddresses(): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) out.add(a.address.toLowerCase().replace(/%.*$/, ""));
  }
  return out;
}

// Classify one IP address (v4 or v6, no brackets).
export function addressKind(ip: string): AddressKind {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (ownAddresses().has(addr)) return "self";
  const v4 = ipv4Kind(addr);
  if (v4) return v4;
  if (addr === "::1" || addr === "::") return "self";
  // IPv4-mapped IPv6, dotted or hex (::ffff:127.0.0.1 / ::ffff:7f00:1).
  const mapped = /^::ffff:(.+)$/.exec(addr);
  if (mapped) {
    const tail = mapped[1];
    if (tail.includes(".")) return ipv4Kind(tail) ?? "public";
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      return ipv4Kind([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")) ?? "public";
    }
  }
  if (/^f[cd][0-9a-f]{2}:/.test(addr) || /^fe[89ab][0-9a-f]:/.test(addr)) return "private";
  return "public";
}

// Classify a URL's host name (before any DNS lookup).
export function hostKind(hostname: string): AddressKind {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === os.hostname().toLowerCase()) return "self";
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return "private";
  if (/^[\d.]+$/.test(host) || host.includes(":")) return addressKind(host);
  return "public";
}

export function classifyFetchUrl(url: string): RiskResult {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { risk: "blocked", reason: "Invalid URL." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { risk: "blocked", reason: `${u.protocol}// URLs are blocked; only http and https are allowed.` };
  }
  const kind = hostKind(u.hostname);
  if (kind === "self") {
    return { risk: "blocked", reason: "Requests to this machine's own services are blocked (including the dashboard's control API)." };
  }
  if (kind === "private") {
    return { risk: "critical", reason: "Requests to other machines on the local network require human approval." };
  }
  return { risk: "medium", reason: "Outbound network request." };
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
