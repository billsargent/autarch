import { NextResponse } from "next/server";
import { LibraryError, readDocFile, removeDoc } from "@/lib/agent/library";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ shelf: string; name: string }> };

// Next may hand the name over decoded already; decoding twice must not throw.
const decoded = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// A document, to view in the page or (?download=1) to save. Untrusted: no
// scripts, forms or plugins, and no type guessing. PDFs go to the browser's
// own viewer, which a sandboxed response would block.
export async function GET(req: Request, { params }: Params) {
  const { shelf, name } = await params;
  try {
    const doc = await readDocFile(shelf, decoded(name));
    const download = new URL(req.url).searchParams.has("download");
    const pdf = doc.mime === "application/pdf";
    return new Response(new Uint8Array(doc.data), {
      headers: {
        "content-type": doc.mime,
        "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        "content-security-policy": pdf ? "default-src 'none'; frame-ancestors 'self'" : "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof LibraryError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

// The owner takes a document off the shelf.
export async function DELETE(_req: Request, { params }: Params) {
  const { shelf, name } = await params;
  try {
    await removeDoc(shelf, decoded(name));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof LibraryError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
