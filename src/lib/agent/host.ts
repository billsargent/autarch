import fs from "node:fs";
import path from "node:path";

// The computer the villagers work on: which system it is, which shell their
// commands run in, and which tools only make sense on Linux. The system
// prompt says all this in one line, so nobody assumes Ubuntu on Windows.

export const IS_WINDOWS = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";

// bash on Linux and macOS. On Windows, Git Bash when it's installed (so the
// usual commands work), otherwise PowerShell.
export const SHELL: { path: string; kind: "bash" | "git-bash" | "powershell" } = (() => {
  if (!IS_WINDOWS) return { path: "/bin/bash", kind: "bash" };
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")];
  for (const root of roots) {
    const bash = root && path.join(root, "Git", "bin", "bash.exe");
    if (bash && fs.existsSync(bash)) return { path: bash, kind: "git-bash" };
  }
  return { path: "powershell.exe", kind: "powershell" };
})();

export const SHELL_NAME = { bash: "bash", "git-bash": "Git Bash", powershell: "Windows PowerShell" }[SHELL.kind];

// apt, systemctl and scrot: hidden from the villagers anywhere but Linux.
export const LINUX_ONLY_TOOLS = ["manage_package", "manage_service", "take_screenshot"];
export const toolWorksHere = (name: string) => IS_LINUX || !LINUX_ONLY_TOOLS.includes(name);
export const notOnThisSystem = (tool: string) =>
  `Refused: ${tool} only works on Linux, and this computer runs ${IS_WINDOWS ? "Windows" : process.platform}.${IS_WINDOWS ? " Use run_shell_command instead (winget for software, PowerShell's Get-Service and Start-Service for services)." : ""}`;

// The Linux distribution, e.g. "Ubuntu 24.04.1 LTS".
function linuxName(): string {
  try {
    const m = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(fs.readFileSync("/etc/os-release", "utf-8"));
    if (m) return m[1];
  } catch {
    /* not there: plain Linux */
  }
  return "Linux";
}

// "D:\root\agent-workspace" → "/d/root/agent-workspace", as Git Bash sees it.
export const gitBashPath = (p: string) => p.replace(/^([A-Za-z]):[\\/]*/, (_, d: string) => `/${d.toLowerCase()}/`).replace(/\\/g, "/");

// One line for the system prompt about this computer and its shell.
export function environmentLine(workspaceDir: string): string {
  if (!IS_WINDOWS) {
    const name = IS_LINUX ? linuxName() : process.platform === "darwin" ? "macOS" : process.platform;
    return `- This computer runs ${name}. run_shell_command runs in bash.`;
  }
  const real = path.resolve(workspaceDir);
  if (SHELL.kind === "git-bash") {
    return `- This computer runs Windows, not Linux. run_shell_command runs in Git Bash: ls, cat, grep, find, sed, pipes and && work, but apt, systemctl, sudo and /proc don't exist. For Windows things use \`powershell -NoProfile -Command "…"\` (Get-Process, Get-Service, winget for software). Commands start in your folder, so relative paths are simplest; in Git Bash the workspace is ${gitBashPath(real)} (Windows: ${real}).`;
  }
  return `- This computer runs Windows, not Linux. run_shell_command runs in Windows PowerShell, so use PowerShell commands (Get-ChildItem, Get-Content, Select-String, Get-Process, winget for software); Linux commands like apt, systemctl and sudo don't exist. The workspace is ${real}.`;
}
