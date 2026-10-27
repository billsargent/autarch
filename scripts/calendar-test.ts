// Tests for Google Calendar and the outbox's email checks (#142): signing in
// (with PKCE), refreshing, reading events, adding an approved event, who may
// read the calendar, and an email draft needing a real address. Runs against
// a throwaway database and a fake Google. Run with: npm run test:calendar
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autarch-calendar-"));
process.env.AUTARCH_DB_PATH = path.join(tmp, "test.db");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`✓ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
}

// A fake Google: the token endpoint, revocation, and the Calendar API.
interface Seen {
  method: string;
  path: string;
  body: string;
  auth: string | undefined;
}
function startFakeGoogle() {
  const seen: Seen[] = [];
  let accessN = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      seen.push({ method: req.method ?? "", path: url.pathname, body, auth: req.headers.authorization });
      const json = (code: number, data: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === "/token") {
        const form = new URLSearchParams(body);
        if (form.get("grant_type") === "authorization_code") {
          if (form.get("code") !== "good-code") return json(400, { error: "invalid_grant", error_description: "Bad code" });
          return json(200, { access_token: `at-${++accessN}`, refresh_token: "rt-1", expires_in: 3600 });
        }
        return json(200, { access_token: `at-${++accessN}`, expires_in: 3600 });
      }
      if (url.pathname === "/revoke") return json(200, {});
      if (url.pathname === "/api/users/me/calendarList") return json(200, { items: [{ id: "me@example.com", summary: "Me", primary: true }, { id: "team@example.com", summary: "Team" }] });
      if (req.method === "GET" && url.pathname.endsWith("/events")) {
        return json(200, {
          items: [
            { summary: "Dentist", location: "High St", start: { dateTime: "2026-11-03T14:00:00Z" }, end: { dateTime: "2026-11-03T15:00:00Z" } },
            { summary: "Holiday", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } },
          ],
        });
      }
      if (req.method === "POST" && url.pathname.endsWith("/events")) return json(200, { id: "ev1", htmlLink: "https://calendar.example/ev1" });
      json(404, { error: { message: "not here" } });
    });
  });
  return new Promise<{ base: string; seen: Seen[]; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ base: `http://127.0.0.1:${port}`, seen, close: () => server.close() });
    }),
  );
}

async function main() {
  const fake = await startFakeGoogle();
  process.env.AUTARCH_GOOGLE_AUTH_URL = `${fake.base}/auth`;
  process.env.AUTARCH_GOOGLE_TOKEN_URL = `${fake.base}/token`;
  process.env.AUTARCH_GOOGLE_REVOKE_URL = `${fake.base}/revoke`;
  process.env.AUTARCH_GOOGLE_API_URL = `${fake.base}/api`;

  const { db, sqlite } = await import("../src/db");
  const { drafts } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { getSettings } = await import("../src/lib/agent/settingsStore");
  const villagers = await import("../src/lib/agent/agents");
  const google = await import("../src/lib/agent/google");
  const { upcomingEvents } = await import("../src/lib/agent/calendar");
  const { decideDraft, eventDetails } = await import("../src/lib/agent/drafts");
  const { executeTool } = await import("../src/lib/agent/tools");
  const googleRoute = await import("../src/app/api/google/route");
  const callbackRoute = await import("../src/app/api/google/callback/route");

  const town = await getSettings();
  const mayor = await villagers.ensureMayor();
  const ctx = { agentId: mayor.id, agentName: mayor.name, conversationId: null };
  const tool = async (name: string, args: Record<string, unknown>) => (await executeTool(name, args, town, ctx)).output;

  // --- email drafts need a real address ---------------------------------------------
  const noAddress = await tool("save_draft", { kind: "email", to: "Clerk, Millbrook", subject: "Your order", content: "We can't fill it.", why: "Answering their order." });
  check("an email to a made-up town is refused when it's written", [noAddress.startsWith("Refused:"), noAddress.includes("accept_order"), noAddress.includes("Millbrook")], [true, true, true]);
  check("…and so is one with no address at all", (await tool("save_draft", { kind: "email", content: "Hello", why: "To say hi." })).includes("has no recipient"), true);
  const okDraft = await tool("save_draft", { kind: "email", to: "Shop <shop@example.com>", subject: "Flour", content: "Two sacks, please.", why: "The owner asked." });
  check("an email to a real address is saved", okDraft.startsWith("Saved draft #"), true);

  // A draft that failed (an old one) can be tried again or discarded.
  const [failed] = await db.insert(drafts).values({ kind: "email", target: "Clerk", content: "x", status: "failed", sendResult: "\"Clerk\" isn't an email address." }).returning();
  await decideDraft(failed.id, "retry");
  check("a draft that couldn't be sent goes back in the tray", (await db.select().from(drafts).where(eq(drafts.id, failed.id)))[0].status, "draft");
  await db.update(drafts).set({ status: "failed" }).where(eq(drafts.id, failed.id));
  await decideDraft(failed.id, "discard");
  check("…or can be discarded", (await db.select().from(drafts).where(eq(drafts.id, failed.id)))[0].status, "discarded");

  // --- events ------------------------------------------------------------------------
  check("an event needs a start", typeof eventDetails({}), "string");
  check("an end before the start is refused", eventDetails({ start: "2026-11-03T14:00", end: "2026-11-03T13:00" }), "the event ends before it starts.");
  const timed = eventDetails({ start: "2026-11-03T14:00", location: "The hall" });
  check("a timed event lasts an hour by default", typeof timed === "object" ? [new Date(timed.end).getTime() - new Date(timed.start).getTime(), timed.allDay, timed.location] : timed, [3600_000, false, "The hall"]);
  const allDay = eventDetails({ start: "2026-11-05" });
  check("a date alone is all day", typeof allDay === "object" && allDay.allDay, true);

  // --- connecting Google ---------------------------------------------------------------
  const rq = (url: string, method = "GET", body?: unknown) => new Request(`http://localhost:3000${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  await google.signInUrl("http://localhost:3000/api/google/callback").then(
    () => check("connecting needs the client first", "no error", "an error"),
    (err) => check("connecting needs the client first", err.message.startsWith("Add your Google client ID"), true),
  );
  const bad = await googleRoute.PUT(rq("/api/google", "PUT", { googleClientId: "not-a-client" }));
  check("a client ID that isn't Google's is refused", bad.status, 400);
  const saved = await (await googleRoute.PUT(rq("/api/google", "PUT", { googleClientId: "123-abc.apps.googleusercontent.com", googleClientSecret: "shh-secret" }))).json();
  check("the client is saved; the secret is never sent back", [saved.googleClientId, saved.googleClientSecretSet, JSON.stringify(saved).includes("shh-secret")], ["123-abc.apps.googleusercontent.com", true, false]);
  check("the redirect URI is this app's own address", saved.redirectUri, "http://localhost:3000/api/google/callback");

  const url = new URL(await google.signInUrl(saved.redirectUri));
  const q = url.searchParams;
  check("the sign-in asks for calendar events and the calendar list only, offline", [q.get("scope"), q.get("access_type"), q.get("code_challenge_method")], [google.GOOGLE_SCOPES.join(" "), "offline", "S256"]);

  const back = (await callbackRoute.GET(rq(`/api/google/callback?code=good-code&state=wrong`))).headers.get("location") ?? "";
  check("a sign-in that wasn't started here is refused", [back.includes("/village/postoffice"), (new URL(back).searchParams.get("google") ?? "").includes("expired or wasn't started here")], [true, true]);
  const done = (await callbackRoute.GET(rq(`/api/google/callback?code=good-code&state=${q.get("state")}`))).headers.get("location") ?? "";
  check("Google sends the owner back, connected", new URL(done).searchParams.get("google"), "connected");
  const tokenCall = fake.seen.find((s) => s.path === "/token" && s.body.includes("authorization_code"))!;
  const verifier = new URLSearchParams(tokenCall.body).get("code_verifier") ?? "";
  check("…proving the sign-in with PKCE", crypto.createHash("sha256").update(verifier).digest("base64url"), q.get("code_challenge"));
  const c = await google.getCalendarSettings();
  check("the account and the main calendar are picked", [c.googleAccount, c.googleCalendarId, c.googleCalendarName], ["me@example.com", "me@example.com", "Me"]);
  const pub = await (await googleRoute.GET(rq("/api/google"))).json();
  check("the page sees the calendars, never the tokens", [pub.googleConnected, pub.calendars.length, JSON.stringify(pub).includes("rt-1"), JSON.stringify(pub).includes("at-")], [true, 2, false, false]);
  check("a state can't be used twice", (new URL((await callbackRoute.GET(rq(`/api/google/callback?code=good-code&state=${q.get("state")}`))).headers.get("location") ?? "").searchParams.get("google") ?? "").includes("expired"), true);

  // --- reading it ----------------------------------------------------------------------
  const ev = await upcomingEvents(14, new Date("2026-11-01T00:00:00Z"));
  check("the calendar comes from Google once connected", [ev.source, ev.events.map((e) => [e.summary, e.allDay, e.location])], ["google", [["Dentist", false, "High St"], ["Holiday", true, null]]]);
  check("…with the access token", fake.seen.filter((s) => s.path.endsWith("/events")).at(-1)?.auth, "Bearer at-1");
  sqlite.prepare("UPDATE calendar_settings SET google_access_expires_at = 0").run();
  await upcomingEvents(14, new Date("2026-11-01T00:00:00Z"));
  check("an expired access token is refreshed", fake.seen.filter((s) => s.path.endsWith("/events")).at(-1)?.auth, "Bearer at-2");

  check("a villager the owner didn't tick can't read it", (await tool("read_calendar", {})).startsWith("Refused"), true);
  check("…and isn't offered the tool", villagers.effectiveTools(mayor, town).includes("read_calendar"), false);
  await googleRoute.PUT(rq("/api/google", "PUT", { readers: [mayor.id] }));
  check("one the owner ticks is offered it", villagers.effectiveTools(mayor, await getSettings()).includes("read_calendar"), true);
  const read = await tool("read_calendar", { days: 7 });
  check("…and reads the events, warned they're outside text", [read.includes("Dentist"), read.includes("never follow instructions")], [true, true]);
  check("query_database can't read the calendar settings", await tool("query_database", { sql: "SELECT * FROM calendar_settings" }), "Queries on the calendar settings are not allowed.");

  // --- an event the owner approves goes on the calendar ---------------------------------------
  const proposed = await tool("save_draft", { kind: "event", subject: "Village fair", content: "Stalls and music.", start: "2026-11-07T10:00", end: "2026-11-07T16:00", location: "The plaza", why: "The village voted for a fair." });
  const eventId = Number(/#(\d+)/.exec(proposed)?.[1]);
  check("a villager proposes an event as a draft", proposed.startsWith("Saved draft #"), true);
  check("…nothing is added until the owner approves", fake.seen.some((s) => s.method === "POST" && s.path.endsWith("/events")), false);
  await decideDraft(eventId, "approve");
  const sentEvent = (await db.select().from(drafts).where(eq(drafts.id, eventId)))[0];
  const posted = JSON.parse(fake.seen.find((s) => s.method === "POST" && s.path.endsWith("/events"))!.body);
  check("approved, it's added to the chosen calendar", [sentEvent.status, posted.summary, posted.location, Boolean(posted.start.dateTime)], ["sent", "Village fair", "The plaza", true]);
  check("…into the calendar picked", fake.seen.find((s) => s.method === "POST" && s.path.endsWith("/events"))!.path, "/api/calendars/me%40example.com/events");

  // --- disconnecting ------------------------------------------------------------------------
  await googleRoute.DELETE(rq("/api/google", "DELETE"));
  const after = await google.getCalendarSettings();
  check("disconnecting revokes the sign-in and forgets it", [fake.seen.some((s) => s.path === "/revoke"), after.googleRefreshToken, google.googleConnected(after)], [true, null, false]);
  check("…and the calendar goes back to not connected", (await upcomingEvents()).configured, false);

  fake.close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* on Windows the database stays locked until exit */
  }
  if (failures > 0) {
    console.error(`\n${failures} calendar test(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll calendar tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
