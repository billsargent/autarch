import { NextResponse } from "next/server";
import { sqlite } from "@/db";
import { LibraryError, listShelves, shelve } from "@/lib/agent/library";
import { libraryReaders } from "@/lib/agent/mailAccess";

export const dynamic = "force-dynamic";

// The library's shelves (#169), for the owner: what's on them, and who may read.
export async function GET() {
  return NextResponse.json({ documents: await listShelves(), readers: libraryReaders() });
}

// The owner puts a document on the shelf (form field "file").
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to put on the shelf." }, { status: 400 });
  try {
    const doc = await shelve("documents", file.name, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ document: doc });
  } catch (err) {
    if (err instanceof LibraryError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

// Who may read the shelves: { readers: [villager ids] }.
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { readers?: unknown };
  if (!Array.isArray(body.readers) || !body.readers.every((n) => Number.isInteger(n))) return NextResponse.json({ error: "readers: a list of villager ids." }, { status: 400 });
  sqlite.prepare("UPDATE agent_settings SET library_readers = ?").run(JSON.stringify([...new Set(body.readers as number[])]));
  return GET();
}
