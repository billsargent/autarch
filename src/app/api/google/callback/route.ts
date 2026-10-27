import { NextResponse } from "next/server";
import { finishSignIn } from "@/lib/agent/google";
import { redirectUri } from "../redirect";

export const dynamic = "force-dynamic";

// Google sends the owner back here (#142); then on to the calendar desk,
// with how it went.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = new URL("/village/postoffice", redirectUri(req));
  back.searchParams.set("open", "post.calendar");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (!code) {
    back.searchParams.set("google", url.searchParams.get("error") === "access_denied" ? "You said no at Google, so nothing was connected." : "Google didn't finish signing in.");
    return NextResponse.redirect(back);
  }
  try {
    await finishSignIn(code, state);
    back.searchParams.set("google", "connected");
  } catch (err) {
    back.searchParams.set("google", err instanceof Error ? err.message : String(err));
  }
  return NextResponse.redirect(back);
}
