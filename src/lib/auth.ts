import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUTH_FILE } from "@/db/path";

// Login for the dashboard (#3): one owner, one password (docs/town-charter.md).
// The password is stored only as a salted scrypt hash in auth.json next to the
// database (hard-protected and secret, so the agent can't read or change it).
// Sessions are signed cookies. Server-only.

export const SESSION_COOKIE = "autarch_session";
export const SESSION_DAYS = 30;
export { AUTH_FILE };
export const MIN_PASSWORD_LENGTH = 8;

interface AuthFile {
  passwordHash: string; // scrypt, hex
  salt: string; // hex
  sessionSecret: string; // hex
}

// --- password hashing ---------------------------------------------------------

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

// --- the auth file ------------------------------------------------------------

// Re-read when the file changes: the proxy and the API routes are built
// separately, so neither can rely on the other's in-memory copy.
let cached: { mtimeMs: number; data: AuthFile } | null = null;

export function readAuth(): AuthFile | null {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(AUTH_FILE).mtimeMs;
  } catch {
    return presetFromEnv();
  }
  if (cached?.mtimeMs === mtimeMs) return cached.data;
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")) as AuthFile;
    cached = { mtimeMs, data };
    return data;
  } catch {
    return null;
  }
}

// AUTARCH_PASSWORD presets the password: it's hashed into auth.json on first
// use and never stored in plain text.
function presetFromEnv(): AuthFile | null {
  const preset = process.env.AUTARCH_PASSWORD;
  if (!preset || preset.length < MIN_PASSWORD_LENGTH) return null;
  setPassword(preset);
  return readAuth();
}

export function isPasswordSet(): boolean {
  return Boolean(readAuth()?.passwordHash);
}

export function setPassword(password: string) {
  const { hash, salt } = hashPassword(password);
  // A fresh session secret signs everyone else out.
  const next: AuthFile = { passwordHash: hash, salt, sessionSecret: crypto.randomBytes(32).toString("hex") };
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = null;
}

export function checkPassword(password: string): boolean {
  const auth = readAuth();
  return Boolean(auth && verifyPassword(password, auth.passwordHash, auth.salt));
}

// --- sessions -----------------------------------------------------------------

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(now = Date.now(), secret = readAuth()?.sessionSecret): string {
  if (!secret) throw new Error("No password has been set.");
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_DAYS * 86_400_000 })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function isValidSession(token: string | undefined, now = Date.now(), secret = readAuth()?.sessionSecret): boolean {
  if (!token || !secret) return false;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return false;
  const expected = sign(payload, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp: number };
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, secure: boolean) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}

// --- first-run setup code -------------------------------------------------------
// Before a password exists, anyone who reaches the page could claim it, so
// setting the first password needs a one-time code printed in the server's
// console. (Route handlers can't see the caller's address, and the Host
// header can be faked, so "you're on this machine" can't be checked safely.)

const g = globalThis as typeof globalThis & { __autarchSetupCode?: string };

export function setupCode(): string {
  if (!g.__autarchSetupCode) {
    g.__autarchSetupCode = crypto.randomBytes(4).toString("hex").toUpperCase().replace(/(.{4})/, "$1-");
    console.log(`[auth] No password is set yet. Open /login and enter setup code ${g.__autarchSetupCode} to choose one.`);
  }
  return g.__autarchSetupCode;
}

// --- login throttling -----------------------------------------------------------

const failures = new Map<string, { count: number; until: number }>();

export function loginLockedFor(key: string, now = Date.now()): number {
  const f = failures.get(key);
  return f && f.until > now ? Math.ceil((f.until - now) / 1000) : 0;
}

export function recordLoginFailure(key: string, now = Date.now()) {
  const f = failures.get(key) ?? { count: 0, until: 0 };
  f.count += 1;
  // After 5 misses, wait 30 s, doubling each further miss (capped at 15 min).
  if (f.count >= 5) f.until = now + Math.min(15 * 60_000, 30_000 * 2 ** (f.count - 5));
  failures.set(key, f);
}

export function clearLoginFailures(key: string) {
  failures.delete(key);
}

// --- the gate (used by src/proxy.ts) ---------------------------------------------

// Paths reachable without a session: the login page and API, the health
// check, and the village art (static files).
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health" ||
    /^\/village\/(scenes|tiles|characters)\//.test(pathname) ||
    pathname === "/village/CREDITS.md" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

// Cross-site request check for anything that changes state: the Origin (or,
// failing that, Sec-Fetch-Site) must say the request came from this site.
export function isCrossSite(method: string, host: string | null, origin: string | null, fetchSite: string | null): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (origin) {
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";
  return false;
}
