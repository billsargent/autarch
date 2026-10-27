import { execFileSync } from "node:child_process";

// Windows drive letters that are network drives (#157): a mapped share is
// someone else's computer, never the villagers' workspace. Asked of Windows
// once, then remembered for a minute. Elsewhere, none.
let cache: { at: number; letters: Set<string> } | null = null;

export function networkDriveLetters(platform: NodeJS.Platform = process.platform): Set<string> {
  if (platform !== "win32") return new Set();
  if (cache && Date.now() - cache.at < 60_000) return cache.letters;
  let letters = new Set<string>();
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Network' } | ForEach-Object { $_.Name.Substring(0, 1) }"],
      { encoding: "utf8", timeout: 5000, windowsHide: true },
    );
    letters = new Set(out.split(/\s+/).filter((l) => /^[A-Za-z]$/.test(l)).map((l) => l.toUpperCase()));
  } catch {
    /* can't tell: treat none as network, the other rules still apply */
  }
  cache = { at: Date.now(), letters };
  return letters;
}
