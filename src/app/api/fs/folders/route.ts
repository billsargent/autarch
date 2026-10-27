import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { normalizeWorkspace, workspaceProblem } from "@/lib/agent/settingsValidation";

export const dynamic = "force-dynamic";

// The workspace folder picker (#157). Owner-only, like every API here (a
// signed-in session; no villager tool calls it). It lists folder names only,
// never files or what's in them, and never network or device paths. A new
// folder may be made only where a workspace could be.

const MAX_FOLDERS = 400;
const remote = (p: string) => /^(\\\\|\/\/)/.test(p);

function listing(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .slice(0, MAX_FOLDERS);
  const parent = path.dirname(dir);
  // The drives on Windows, so the owner can move between them.
  const drives = process.platform === "win32" ? "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((d) => fs.existsSync(d)) : [];
  return { path: dir, parent: parent === dir ? null : parent, folders, drives, home: os.homedir(), problem: workspaceProblem(dir), sep: path.sep };
}

function pathFrom(raw: string | null): string | { error: string } {
  const p = normalizeWorkspace(raw?.trim() || os.homedir());
  if (remote(p)) return { error: "Network and device paths can't be browsed here." };
  if (!path.isAbsolute(p)) return { error: "Give a full path." };
  return path.resolve(p);
}

export async function GET(req: Request) {
  const p = pathFrom(new URL(req.url).searchParams.get("path"));
  if (typeof p !== "string") return NextResponse.json(p, { status: 400 });
  try {
    return NextResponse.json(listing(p));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return NextResponse.json({ error: code === "ENOENT" ? "That folder doesn't exist." : code === "EACCES" || code === "EPERM" ? "This app isn't allowed to look in that folder." : "Couldn't open that folder." }, { status: 400 });
  }
}

// A new folder, inside the one being looked at.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { path?: string; name?: string };
  const p = pathFrom(body.path ?? null);
  if (typeof p !== "string") return NextResponse.json(p, { status: 400 });
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 100 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || name === "." || name === "..") {
    return NextResponse.json({ error: "Give the new folder a plain name (no slashes or : * ? \" < > |)." }, { status: 400 });
  }
  const target = path.join(p, name);
  const problem = workspaceProblem(target);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  try {
    fs.mkdirSync(target);
    return NextResponse.json(listing(target));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return NextResponse.json({ error: code === "EEXIST" ? "A folder with that name is already there." : "Couldn't make that folder." }, { status: 400 });
  }
}
