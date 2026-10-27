// Where Google sends the owner back after signing in (#142): this app's own
// address, as the browser reached it. It must match the redirect URI in the
// owner's Google Cloud OAuth client exactly.
import { CALLBACK_PATH } from "@/lib/agent/google";

export function redirectUri(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${proto}://${host}${CALLBACK_PATH}`;
}
