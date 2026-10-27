import { NextResponse } from "next/server";
import { GoogleError, signInUrl } from "@/lib/agent/google";
import { redirectUri } from "../redirect";

export const dynamic = "force-dynamic";

// "Connect Google Calendar" (#142): off to Google's sign-in page.
export async function GET(req: Request) {
  try {
    return NextResponse.redirect(await signInUrl(redirectUri(req)));
  } catch (err) {
    if (err instanceof GoogleError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
