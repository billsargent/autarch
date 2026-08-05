import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getSettings } from "@/lib/agent/settingsStore";
import { MAX_DOWNLOAD_BYTES } from "@/lib/agent/config";

export async function POST(req: Request) {
  try {
    const settings = await getSettings();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided (form field 'file')." }, { status: 400 });
    }
    if (file.size > MAX_DOWNLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)}MB cap.` },
        { status: 413 },
      );
    }
    const base = path.basename(file.name).replace(/[^\w.\- ]+/g, "_") || "upload.bin";
    const buf = Buffer.from(await file.arrayBuffer());
    const uploadDir = path.join(settings.workspaceDir, "uploads");
    await fs.mkdir(uploadDir, { recursive: true });
    const dest = path.join(uploadDir, base);
    await fs.writeFile(dest, buf);
    const rel = path.relative(settings.workspaceDir, dest).split(path.sep).join("/");
    return NextResponse.json({
      ok: true,
      path: dest,
      url: `/api/files/${rel}`,
      size: buf.length,
      filename: base,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
