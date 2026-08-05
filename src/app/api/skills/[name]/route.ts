import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getSettings } from "@/lib/agent/settingsStore";
import { workspaceSkillsDir } from "@/lib/agent/config";

const MAX_SKILL_CHARS = 3000;

function safeName(raw: string): string | null {
  const base = String(raw).trim().replace(/\.md$/i, "");
  if (!base || /[/\\]|\.\./.test(base)) return null;
  return base + ".md";
}

function contained(dir: string, full: string): boolean {
  return path.dirname(path.resolve(full)) === path.resolve(dir);
}

export async function PUT(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const safe = safeName(name);
  if (!safe) return NextResponse.json({ error: "Invalid skill name." }, { status: 400 });
  const settings = await getSettings();
  const dir = workspaceSkillsDir(settings.workspaceDir);
  const full = path.join(dir, safe);
  if (!contained(dir, full)) return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(full, content, "utf-8");
  return NextResponse.json({ ok: true, name: safe, truncatedInPrompt: content.length > MAX_SKILL_CHARS });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const safe = safeName(name);
  if (!safe) return NextResponse.json({ error: "Invalid skill name." }, { status: 400 });
  const settings = await getSettings();
  const dir = workspaceSkillsDir(settings.workspaceDir);
  const full = path.join(dir, safe);
  if (!contained(dir, full)) return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  try {
    await fs.unlink(full);
  } catch {
    // already gone is fine
  }
  return NextResponse.json({ ok: true });
}
