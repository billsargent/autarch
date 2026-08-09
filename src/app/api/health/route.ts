import { db } from "@/db";
import { sql } from "drizzle-orm";
import { execSync } from "node:child_process";

export const dynamic = "force-dynamic";

let _hash = "";
function gitHash() {
  if (_hash) return _hash;
  try {
    _hash = execSync("git rev-parse --short HEAD", { encoding: "utf-8", timeout: 2000 }).trim();
  } catch {
    _hash = "unknown";
  }
  return _hash;
}

export async function GET() {
  try {
    db.get(sql`select 1 as ok`);
    return Response.json({ ok: true, version: gitHash() });
  } catch {
    return Response.json({ ok: false, version: gitHash() }, { status: 500 });
  }
}
