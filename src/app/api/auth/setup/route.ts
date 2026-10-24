import { NextResponse } from "next/server";
import {
  MIN_PASSWORD_LENGTH,
  createSessionToken,
  isPasswordSet,
  loginLockedFor,
  recordLoginFailure,
  sessionCookie,
  setPassword,
  setupCode,
} from "@/lib/auth";

// First run: choose the owner password. Needs the one-time setup code from
// the server console, so whoever reaches the page first can't claim it.
export async function POST(req: Request) {
  if (isPasswordSet()) return NextResponse.json({ error: "A password is already set. Sign in instead." }, { status: 409 });
  const wait = loginLockedFor("setup");
  if (wait) return NextResponse.json({ error: `Too many tries. Wait ${wait} seconds.` }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (code !== setupCode()) {
    recordLoginFailure("setup");
    return NextResponse.json({ error: "That setup code isn't right. It's printed in the server's console." }, { status: 403 });
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, { status: 400 });
  }
  setPassword(password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(createSessionToken(), new URL(req.url).protocol === "https:"));
  return res;
}
