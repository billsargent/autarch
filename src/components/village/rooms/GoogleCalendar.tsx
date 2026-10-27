"use client";

import { useCallback, useEffect, useState } from "react";
import { useVillagers } from "../../data/useVillagers";

// Google Calendar (#142): set up once with the owner's own Google Cloud OAuth
// client, then connected with Google's sign-in. Villagers the owner ticks can
// read it; events they propose wait in the outbox until the owner approves.

interface GoogleState {
  googleClientId: string;
  googleClientSecretSet: boolean;
  googleConnected: boolean;
  googleAccount: string;
  googleCalendarId: string;
  villageCalendarId: string;
  villageCalendarName: string;
  googleCalendarName: string;
  readers: number[];
  redirectUri: string;
  calendars: Array<{ id: string; summary: string; primary: boolean }>;
}

const input = "mt-1 block w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 font-normal";

export default function GoogleCalendar({ onChange }: { onChange: () => void }) {
  const [g, setG] = useState<GoogleState | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // How the sign-in went, when Google sends the owner back (?google=…).
  const [back] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("google")));
  const { villagers } = useVillagers(30000);

  const load = useCallback(async () => {
    try {
      setG(await fetch("/api/google", { cache: "no-store" }).then((r) => r.json()));
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function call(method: "PUT" | "DELETE", body?: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/google", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
    else setG(data);
    onChange();
    return res.ok;
  }

  if (!g) return null;
  const ready = Boolean(g.googleClientId && g.googleClientSecretSet);
  return (
    <div className="mt-2 rounded border border-[#d8c49a] bg-white/50 p-2">
      <p className="font-semibold">Google Calendar {g.googleConnected ? "· connected" : ""}</p>
      {back && <p className={`mt-0.5 ${back === "connected" ? "" : "text-[#b3261e]"}`}>{back === "connected" ? "✅ Connected to Google Calendar." : back}</p>}

      {g.googleConnected ? (
        <>
          <p className="mt-0.5 text-[#6b4a2e]">
            Signed in as <strong>{g.googleAccount || "your Google account"}</strong>. Villagers you tick can read it; events they propose wait in
            your outbox and are added only when you approve them.
          </p>
          <label className="mt-1.5 block font-semibold">
            The calendar to use
            <select
              name="googleCalendarId"
              value={g.googleCalendarId}
              onChange={(e) => void call("PUT", { googleCalendarId: e.target.value, googleCalendarName: g.calendars.find((k) => k.id === e.target.value)?.summary ?? "" })}
              className={input}
            >
              {!g.calendars.some((k) => k.id === g.googleCalendarId) && <option value={g.googleCalendarId}>{g.googleCalendarName || g.googleCalendarId}</option>}
              {g.calendars.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.summary}
                  {k.primary ? " (your main calendar)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-1.5 block font-semibold">
            Copy the village calendar to
            <select
              name="villageCalendarId"
              value={g.villageCalendarId}
              onChange={(e) => void call("PUT", { villageCalendarId: e.target.value, villageCalendarName: g.calendars.find((k) => k.id === e.target.value)?.summary ?? "" })}
              className={input}
            >
              <option value="">Don&apos;t copy it</option>
              {g.villageCalendarId && !g.calendars.some((k) => k.id === g.villageCalendarId) && <option value={g.villageCalendarId}>{g.villageCalendarName || g.villageCalendarId}</option>}
              {g.calendars.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.summary}
                  {k.primary ? " (your main calendar)" : ""}
                </option>
              ))}
            </select>
            <span className="mt-0.5 block font-normal text-[#6b4a2e]">
              Festivals, meetings and the rest are added there as they&apos;re planned, and taken off when cancelled. Make a calendar called
              &quot;Village&quot; in Google Calendar first if you&apos;d like them kept apart from your own.
            </span>
          </label>
          <button onClick={() => void call("DELETE")} className="mt-1.5 text-[11px] underline">
            Disconnect Google
          </button>
        </>
      ) : (
        <>
          <p className="mt-0.5 text-[#6b4a2e]">
            To let villagers see your calendar and propose events, connect it with Google&apos;s sign-in. It takes a one-time setup in your own
            Google Cloud project (free):
          </p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[#6b4a2e]">
            <li>
              In the{" "}
              <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="underline">
                Google Cloud console
              </a>
              , make a project and turn on the <strong>Google Calendar API</strong>.
            </li>
            <li>
              Set up the <strong>OAuth consent screen</strong> (External, Testing) and add your own Google address as a test user.
            </li>
            <li>
              Make an <strong>OAuth client ID</strong> of type <strong>Web application</strong>, with this redirect URI:
              <span className="mt-0.5 flex items-center gap-1.5">
                <code className="break-all rounded bg-[#f4ead5] px-1">{g.redirectUri}</code>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(g.redirectUri);
                      setCopied(true);
                    } catch {
                      /* select it instead */
                    }
                  }}
                  className="village-btn px-1.5 py-0.5 text-[10px]"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </span>
              Google only accepts <code>http://localhost</code> or an <code>https://</code> address, so open the village that way when you connect.
            </li>
            <li>Paste the client ID and secret here, save, then connect.</li>
          </ol>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            <label className="block font-semibold">
              Client ID
              <input name="googleClientId" value={clientId || g.googleClientId} onChange={(e) => setClientId(e.target.value)} placeholder="….apps.googleusercontent.com" className={input} />
            </label>
            <label className="block font-semibold">
              Client secret
              <input
                name="googleClientSecret"
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={g.googleClientSecretSet ? "•••••••• (set; type to replace)" : "Not set"}
                className={input}
              />
            </label>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              disabled={!clientId.trim() && !secret.trim()}
              onClick={async () => {
                if (await call("PUT", { ...(clientId.trim() ? { googleClientId: clientId.trim() } : {}), ...(secret.trim() ? { googleClientSecret: secret.trim() } : {}) })) {
                  setClientId("");
                  setSecret("");
                }
              }}
              className="village-btn px-2 py-1 text-[11px] disabled:opacity-50"
            >
              Save
            </button>
            <a href="/api/google/connect" aria-disabled={!ready} className={`village-btn village-btn-go px-2 py-1 text-[11px] ${ready ? "" : "pointer-events-none opacity-50"}`}>
              Connect Google Calendar
            </a>
          </div>
        </>
      )}

      <fieldset className="mt-2">
        <legend className="font-semibold">Who may read your calendar</legend>
        <p className="text-[#6b4a2e]">Nobody, unless you tick them. They get a read-only read_calendar tool.</p>
        <div className="mt-0.5 flex flex-wrap gap-x-3">
          {villagers.map((v) => (
            <label key={v.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={g.readers.includes(v.id)}
                onChange={(e) => void call("PUT", { readers: e.target.checked ? [...g.readers, v.id] : g.readers.filter((r) => r !== v.id) })}
              />
              {v.name}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-1 text-[#b3261e]">{error}</p>}
    </div>
  );
}
