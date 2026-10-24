import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isPasswordSet, isValidSession, setupCode } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Whether a password exists yet and whether this browser is signed in.
export async function GET() {
  const passwordSet = isPasswordSet();
  // Asking for status before a password exists prints the setup code in the
  // server console (once).
  if (!passwordSet) setupCode();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return NextResponse.json({ passwordSet, signedIn: passwordSet && isValidSession(token) });
}
