import crypto from "node:crypto";
import { db } from "@/db";
import { calendarSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { CalEvent } from "./calendar";

// Google Calendar (#142), signed in with the owner's own Google Cloud OAuth
// client (docs/email-and-calendar.md). The client secret and the tokens stay
// on this machine: no API returns them and query_database refuses the table.
// Villagers read the calendar with read_calendar (if the owner lets them) and
// propose events as drafts; an event is added only when the owner approves it.
// The addresses can be overridden for tests (AUTARCH_GOOGLE_*).

const AUTH_URL = process.env.AUTARCH_GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.AUTARCH_GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const REVOKE_URL = process.env.AUTARCH_GOOGLE_REVOKE_URL ?? "https://oauth2.googleapis.com/revoke";
const API = process.env.AUTARCH_GOOGLE_API_URL ?? "https://www.googleapis.com/calendar/v3";
// Events in any calendar, and the list of calendars; nothing else.
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"];
export const CALLBACK_PATH = "/api/google/callback";

export class GoogleError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export type CalendarRow = typeof calendarSettings.$inferSelect;

export async function getCalendarSettings(): Promise<CalendarRow> {
  const [row] = await db.select().from(calendarSettings).where(eq(calendarSettings.id, 1));
  if (row) return row;
  const [made] = await db.insert(calendarSettings).values({ id: 1 }).returning();
  return made;
}

async function update(patch: Partial<CalendarRow>) {
  await getCalendarSettings();
  await db.update(calendarSettings).set({ ...patch, updatedAt: new Date() }).where(eq(calendarSettings.id, 1));
}

export const googleConnected = (c: CalendarRow) => Boolean(c.googleClientId && c.googleClientSecret && c.googleRefreshToken);

// What the owner's page sees: never the secret or the tokens.
export function publicCalendar(c: CalendarRow, redirectUri: string) {
  return {
    googleClientId: c.googleClientId ?? "",
    googleClientSecretSet: Boolean(c.googleClientSecret),
    googleConnected: googleConnected(c),
    googleAccount: c.googleAccount ?? "",
    googleCalendarId: c.googleCalendarId ?? "",
    googleCalendarName: c.googleCalendarName ?? "",
    villageCalendarId: c.villageCalendarId ?? "",
    villageCalendarName: c.villageCalendarName ?? "",
    readers: (c.readers as number[]) ?? [],
    redirectUri,
  };
}

export async function saveCalendarSettings(patch: Record<string, unknown>) {
  const out: Partial<CalendarRow> = {};
  if (typeof patch.googleClientId === "string") {
    const id = patch.googleClientId.trim();
    if (id && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) throw new GoogleError("That doesn't look like a Google client ID (it ends in .apps.googleusercontent.com).", 400);
    out.googleClientId = id || null;
  }
  if (typeof patch.googleClientSecret === "string" && patch.googleClientSecret.trim()) out.googleClientSecret = patch.googleClientSecret.trim();
  if (typeof patch.googleCalendarId === "string") {
    out.googleCalendarId = patch.googleCalendarId || null;
    out.googleCalendarName = typeof patch.googleCalendarName === "string" ? patch.googleCalendarName.slice(0, 200) : null;
  }
  if (typeof patch.villageCalendarId === "string") {
    out.villageCalendarId = patch.villageCalendarId || null;
    out.villageCalendarName = patch.villageCalendarId && typeof patch.villageCalendarName === "string" ? patch.villageCalendarName.slice(0, 200) : null;
  }
  if (Array.isArray(patch.readers)) out.readers = patch.readers.filter((n): n is number => Number.isInteger(n));
  // A new client means signing in again.
  if (out.googleClientId !== undefined || out.googleClientSecret !== undefined) Object.assign(out, { googleRefreshToken: null, googleAccessToken: null, googleAccessExpiresAt: null });
  await update(out);
}

// --- signing in ----------------------------------------------------------------

// Sign-ins waiting for Google to send the owner back: state → PKCE verifier.
const pending: Map<string, { verifier: string; redirectUri: string; at: number }> =
  ((globalThis as { __googlePending?: Map<string, { verifier: string; redirectUri: string; at: number }> }).__googlePending ??= new Map());
const PENDING_MS = 10 * 60_000;

export async function signInUrl(redirectUri: string): Promise<string> {
  const c = await getCalendarSettings();
  if (!c.googleClientId || !c.googleClientSecret) throw new GoogleError("Add your Google client ID and secret first.");
  for (const [k, v] of pending) if (Date.now() - v.at > PENDING_MS) pending.delete(k);
  const state = crypto.randomBytes(16).toString("hex");
  const verifier = crypto.randomBytes(32).toString("base64url");
  pending.set(state, { verifier, redirectUri, at: Date.now() });
  const q = new URLSearchParams({
    client_id: c.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new GoogleError(`Google said no: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`);
  return data;
}

// Google sent the owner back with a code: swap it for tokens, then pick the
// primary calendar unless one is chosen already.
export async function finishSignIn(code: string, state: string): Promise<void> {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now() - p.at > PENDING_MS) throw new GoogleError("That sign-in had expired or wasn't started here. Try again.", 400);
  const c = await getCalendarSettings();
  const t = await tokenRequest({
    code,
    client_id: c.googleClientId ?? "",
    client_secret: c.googleClientSecret ?? "",
    redirect_uri: p.redirectUri,
    grant_type: "authorization_code",
    code_verifier: p.verifier,
  });
  if (!t.refresh_token) throw new GoogleError("Google didn't give a lasting sign-in. Remove the app's access in your Google account, then connect again.");
  await update({ googleRefreshToken: t.refresh_token, googleAccessToken: t.access_token, googleAccessExpiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 });
  const primary = (await listCalendars()).find((k) => k.primary);
  const now = await getCalendarSettings();
  await update({
    googleAccount: primary?.id ?? now.googleAccount,
    ...(now.googleCalendarId ? {} : { googleCalendarId: primary?.id ?? "primary", googleCalendarName: primary?.summary ?? "Your calendar" }),
  });
}

export async function disconnectGoogle(): Promise<void> {
  const c = await getCalendarSettings();
  if (c.googleRefreshToken) {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(c.googleRefreshToken)}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }
  await update({ googleRefreshToken: null, googleAccessToken: null, googleAccessExpiresAt: null, googleAccount: null, googleCalendarId: null, googleCalendarName: null });
}

async function accessToken(): Promise<string> {
  const c = await getCalendarSettings();
  if (!googleConnected(c)) throw new GoogleError("Google Calendar isn't connected.");
  if (c.googleAccessToken && (c.googleAccessExpiresAt ?? 0) > Date.now() + 60_000) return c.googleAccessToken;
  const t = await tokenRequest({ client_id: c.googleClientId!, client_secret: c.googleClientSecret!, refresh_token: c.googleRefreshToken!, grant_type: "refresh_token" });
  await update({ googleAccessToken: t.access_token, googleAccessExpiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token!;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new GoogleError(`Google Calendar said: ${data.error?.message ?? `HTTP ${res.status}`}`);
  return data;
}

// --- the calendar --------------------------------------------------------------

export async function listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
  const data = await api<{ items?: Array<{ id: string; summary?: string; summaryOverride?: string; primary?: boolean }> }>("/users/me/calendarList?minAccessRole=writer");
  return (data.items ?? []).map((k) => ({ id: k.id, summary: k.summaryOverride ?? k.summary ?? k.id, primary: Boolean(k.primary) }));
}

interface GEvent {
  summary?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

// "2026-10-28" is a whole day, read as local midnight.
const gDate = (t?: { date?: string; dateTime?: string }) => (t?.dateTime ? new Date(t.dateTime) : t?.date ? new Date(`${t.date}T00:00:00`) : null);

export async function googleEvents(from: Date, to: Date): Promise<CalEvent[]> {
  const c = await getCalendarSettings();
  const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const data = await api<{ items?: GEvent[] }>(`/calendars/${encodeURIComponent(c.googleCalendarId || "primary")}/events?${q}`);
  return (data.items ?? [])
    .map((e) => ({ summary: e.summary ?? "(no title)", start: gDate(e.start), end: gDate(e.end), allDay: Boolean(e.start?.date), location: e.location ?? null }))
    .filter((e): e is CalEvent => e.start != null);
}

export interface EventDetails {
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Adds an approved event to the chosen calendar.
export async function createGoogleEvent(e: { title: string; description: string; details: EventDetails }): Promise<string> {
  const c = await getCalendarSettings();
  const made = await insertEvent(c.googleCalendarId || "primary", e);
  return `Added to ${c.googleCalendarName || "your calendar"}.${made.htmlLink ? ` ${made.htmlLink}` : ""}`;
}

// The village calendar's copy (#173): an event added to a given calendar, by id.
export async function createEventIn(calendarId: string, e: { title: string; description: string; details: EventDetails }): Promise<string> {
  return (await insertEvent(calendarId, e)).id;
}

export async function deleteEventIn(calendarId: string, eventId: string): Promise<void> {
  const res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(15_000),
  });
  // Already gone from Google (deleted there by hand) counts as done.
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new GoogleError(`Google Calendar said: HTTP ${res.status}`);
}

async function insertEvent(calendarId: string, e: { title: string; description: string; details: EventDetails }): Promise<{ id: string; htmlLink?: string }> {
  const start = new Date(e.details.start);
  const end = new Date(e.details.end);
  const when = e.details.allDay
    ? { start: { date: ymd(start) }, end: { date: ymd(new Date(Math.max(end.getTime(), start.getTime() + 86400_000))) } }
    : { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
  return api<{ id: string; htmlLink?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify({ summary: e.title, description: e.description, ...(e.details.location ? { location: e.details.location } : {}), ...when }),
  });
}
