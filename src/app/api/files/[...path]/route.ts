import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getSettings } from "@/lib/agent/settingsStore";
import { resolvePathSafe, isSecretPath } from "@/lib/agent/risk";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".js": "text/javascript",
  ".ts": "text/plain",
  ".py": "text/plain",
  ".sh": "text/plain",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".db": "application/octet-stream",
};

function isWithin(parent: string, child: string) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await params;
  const settings = await getSettings();
  const rel = segs.join("/");
  const resolved = resolvePathSafe(rel, settings.workspaceDir);
  if (!isWithin(path.resolve(settings.workspaceDir), path.resolve(resolved))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (isSecretPath(resolved)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": MIME[ext] || "application/octet-stream",
        "content-disposition": `inline; filename="${path.basename(resolved)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
