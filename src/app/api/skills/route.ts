import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getSettings } from "@/lib/agent/settingsStore";
import { workspaceSkillsDir } from "@/lib/agent/config";

// Matches the per-skill injection budget in buildSystemPrompt.
const MAX_SKILL_CHARS = 3000;

function sanitizeSkillName(raw: string): string | null {
  const base = raw.trim().replace(/\.md$/i, "");
  if (!base || /[/\\]|\.\./.test(base)) return null;
  return base + ".md";
}

export async function GET() {
  const settings = await getSettings();
  const dir = workspaceSkillsDir(settings.workspaceDir);
  try {
    const names = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
    const skills = [];
    for (const name of names.sort()) {
      const full = path.join(dir, name);
      const content = await fs.readFile(full, "utf-8");
      const stat = await fs.stat(full);
      skills.push({
        name,
        content,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        truncatedInPrompt: content.length > MAX_SKILL_CHARS,
      });
    }
    return NextResponse.json({ skills });
  } catch {
    return NextResponse.json({ skills: [] });
  }
}

export async function POST(req: Request) {
  const settings = await getSettings();
  const dir = workspaceSkillsDir(settings.workspaceDir);
  await fs.mkdir(dir, { recursive: true });
  const body = await req.json().catch(() => ({}));
  const name = sanitizeSkillName(typeof body.name === "string" ? body.name : "");
  if (!name) {
    return NextResponse.json({ error: "Invalid skill name." }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content : "";
  const full = path.join(dir, name);
  if (path.dirname(full) !== dir) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }
  await fs.writeFile(full, content, "utf-8");
  return NextResponse.json({ ok: true, name, truncatedInPrompt: content.length > MAX_SKILL_CHARS });
}
