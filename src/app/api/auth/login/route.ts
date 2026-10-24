import { NextResponse } from "next/server";
import {
  checkPassword,
  clearLoginFailures,
  createSessionToken,
  isPasswordSet,
  loginLockedFor,
  recordLoginFailure,
  sessionCookie,
} from "@/lib/auth";

export async function POST(req: Request) {
  if (!isPasswordSet()) return NextResponse.json({ error: "No password is set yet." }, { status: 409 });
  // One shared counter: route handlers can't see the caller's address, and a
  // forwarded-for header could be faked to dodge a per-client limit.
  const who = "login";
  const wait = loginLockedFor(who);
  if (wait) return NextResponse.json({ error: `Too many tries. Wait ${wait} seconds.` }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!checkPassword(password)) {
    recordLoginFailure(who);
    return NextResponse.json({ error: "That password isn't right." }, { status: 401 });
  }
  clearLoginFailures(who);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(createSessionToken(), new URL(req.url).protocol === "https:"));
  return res;
}
