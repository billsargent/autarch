import { NextResponse } from "next/server";
import { MailError, getMail, publicMail, updateMail } from "@/lib/agent/email";

export const dynamic = "force-dynamic";

// The owner's email settings (#124). Passwords are write-only: they're never
// sent back, only whether one is set.
export async function GET() {
  return NextResponse.json(publicMail(await getMail()));
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send the settings as JSON." }, { status: 400 });
  try {
    return NextResponse.json(publicMail(await updateMail(body)));
  } catch (err) {
    if (err instanceof MailError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
