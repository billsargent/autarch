import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getSettings } from "@/lib/agent/settingsStore";
import { resolvePathSafe, isSecretPath, isReallyWithin } from "@/lib/agent/risk";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".log": "text/plain",
  ".csv": "text/csv",
  // Never served as live HTML or script on the dashboard's origin (#7).
  ".html": "text/plain; charset=utf-8",
  ".htm": "text/plain; charset=utf-8",
  ".js": "text/plain; charset=utf-8",
  ".mjs": "text/plain; charset=utf-8",
  ".xml": "text/plain; charset=utf-8",
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
  // Real locations, so a symlink in the workspace can't serve files from
  // elsewhere (#9).
  if (!isWithin(path.resolve(settings.workspaceDir), path.resolve(resolved)) || !isReallyWithin(settings.workspaceDir, resolved)) {
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
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(resolved))}`,
        // The agent writes these files, so treat them as untrusted: no
        // scripts, forms or plugins even if opened directly (SVGs included),
        // and no content-type guessing.
        "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
