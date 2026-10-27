import { NextResponse } from "next/server";
import { testImap, testSmtp } from "@/lib/agent/email";

export const dynamic = "force-dynamic";

// "Send a test" and "Check inbox" (#124). A failure comes back as the
// server's own words, so the owner can see what to fix.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.what !== "smtp" && body.what !== "imap") return NextResponse.json({ error: "what: smtp or imap." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, message: body.what === "smtp" ? await testSmtp() : await testImap() });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}
