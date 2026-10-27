"use client";

import { useCallback, useEffect, useState } from "react";
import { useVillagers } from "../../data/useVillagers";
import { MAIL_PRESETS, PRESET_KEYS, isPresetKey, type MailPreset } from "@/lib/agent/mailPresets";

// The Mayor's ledger → Email (#124): the owner's SMTP server (approved email
// drafts go out through it) and IMAP inbox (read-only, for the villagers the
// owner picks). Passwords are write-only: the page only knows whether one is set.

type Security = "tls" | "starttls" | "none";
interface Mail {
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  smtpUser: string;
  smtpPasswordSet: boolean;
  fromAddress: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  imapUser: string;
  imapPasswordSet: boolean;
  imapMailbox: string;
  readers: number[];
  fromName: string;
  footer: boolean;
  dailyCap: number;
  knownOnly: boolean;
  preset: string;
  smtpReady: boolean;
  imapReady: boolean;
}

const input = "mt-1 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 text-xs font-normal outline-none";
const SECURITY_LABEL: Record<Security, string> = { tls: "TLS (usually port 465 / 993)", starttls: "STARTTLS (usually port 587 / 143)", none: "None (local servers only)" };

export default function EmailPage() {
  const [mail, setMail] = useState<Mail | null>(null);
  const [form, setForm] = useState<Partial<Record<keyof Mail | "smtpPassword" | "imapPassword", string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ smtp?: string; imap?: string }>({});
  const { villagers } = useVillagers(30000);

  const load = useCallback(async () => {
    try {
      setMail(await fetch("/api/email", { cache: "no-store" }).then((r) => r.json()));
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const put = async (patch: Record<string, unknown>) => {
    setSaved(false);
    const res = await fetch("/api/email", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? `HTTP ${res.status}`);
      return false;
    }
    setError(null);
    setMail(data);
    setSaved(true);
    return true;
  };
  const save = async () => {
    const patch: Record<string, unknown> = { ...form };
    for (const k of ["smtpPort", "imapPort", "dailyCap"] as const) if (k in patch) patch[k] = Number(patch[k]);
    if (await put(patch)) setForm({});
  };
  const runTest = async (what: "smtp" | "imap") => {
    setTest((t) => ({ ...t, [what]: what === "smtp" ? "Sending…" : "Checking…" }));
    const res = await fetch("/api/email/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ what }) });
    const data = await res.json().catch(() => ({}));
    setTest((t) => ({ ...t, [what]: `${data.ok ? "✅" : "❌"} ${data.message ?? data.error ?? "No answer."}` }));
  };

  if (!mail) return <p className="text-sm">Reading the ledger…</p>;
  // A provider with app passwords (#142): one address and one app password
  // fill in both sending and reading; the servers come from the preset.
  const presetKey = form.preset ?? mail.preset;
  const preset = isPresetKey(presetKey) ? (MAIL_PRESETS[presetKey] as MailPreset) : null;
  const simple = preset?.auth === "app-password";
  const val = (k: keyof Mail) => (form[k] ?? String(mail[k] ?? "")) as string;
  const set = (k: keyof Mail | "smtpPassword" | "imapPassword") => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty = Object.keys(form).length > 0;
  const field = (label: string, k: keyof Mail, props: { type?: string; placeholder?: string; autoComplete?: string } = {}) => (
    <label className="block text-xs font-semibold">
      {label}
      <input name={k} value={val(k)} onChange={set(k)} className={input} {...props} />
    </label>
  );
  const security = (k: "smtpSecurity" | "imapSecurity") => (
    <label className="block text-xs font-semibold">
      Security
      <select name={k} value={val(k)} onChange={set(k)} className={input}>
        {(Object.keys(SECURITY_LABEL) as Security[]).map((s) => (
          <option key={s} value={s}>
            {SECURITY_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
  const password = (k: "smtpPassword" | "imapPassword", isSet: boolean, clear: "clearSmtpPassword" | "clearImapPassword") => (
    <label className="block text-xs font-semibold">
      Password
      <input
        name={k}
        type="password"
        autoComplete="new-password"
        value={form[k] ?? ""}
        onChange={set(k)}
        placeholder={isSet ? "•••••••• (set; type to replace)" : "Not set"}
        className={input}
      />
      {isSet && (
        <button type="button" onClick={() => void put({ [clear]: true })} className="mt-1 text-[11px] font-normal text-[#b3261e] underline">
          Remove the password
        </button>
      )}
    </label>
  );

  return (
    <section className="space-y-4">
      <div>
        <h3 className="village-pixel text-base">Email</h3>
        <p className="mt-1 text-xs text-[#6b4a2e]">
          Your own mail account, over plain SMTP and IMAP, so any provider works (for Gmail and others, use an app password). Villagers never send
          mail themselves: they write drafts, and an email draft you approve in your outbox goes out from here. Passwords are kept on this machine,
          never shown again, and no villager or tool can read them.
        </p>
      </div>

      <label className="block text-xs font-semibold">
        Your mail provider
        <select
          name="preset"
          value={form.preset ?? mail.preset}
          onChange={(e) => {
            const p = isPresetKey(e.target.value) ? MAIL_PRESETS[e.target.value] : null;
            setForm((f) => ({
              ...f,
              preset: e.target.value,
              ...(p
                ? {
                    smtpHost: p.smtp.host,
                    smtpPort: String(p.smtp.port),
                    smtpSecurity: p.smtp.security,
                    imapHost: p.imap.host,
                    imapPort: String(p.imap.port),
                    imapSecurity: p.imap.security,
                  }
                : {}),
            }));
          }}
          className={input}
        >
          <option value="">Other (fill in the servers yourself)</option>
          {PRESET_KEYS.map((k) => (
            <option key={k} value={k}>
              {MAIL_PRESETS[k].label}
            </option>
          ))}
        </select>
      </label>
      {(() => {
        const key = form.preset ?? mail.preset;
        if (!isPresetKey(key)) return null;
        const p = MAIL_PRESETS[key] as MailPreset;
        return (
          <p className={`rounded border-2 px-3 py-2 text-[11px] ${p.auth === "oauth" ? "border-[#b3261e] bg-[#fbe3df]" : "border-[#d8c49a] bg-[#fffaf0]"}`}>
            {p.note}{" "}
            <a href={p.help} target="_blank" rel="noreferrer" className="underline">
              {p.auth === "app-password" ? "Make an app password" : p.auth === "oauth" ? "How Microsoft sign-in works" : "Get it"}
            </a>
          </p>
        );
      })()}

      {simple && (
        <fieldset className="space-y-2 rounded border-2 border-[#3b2716] bg-[#fffaf0]/60 p-3">
          <legend className="px-1 text-xs font-semibold">Your account {mail.smtpReady && mail.imapReady ? "· ready" : ""}</legend>
          <label className="block text-xs font-semibold">
            Your email address
            <input
              name="account"
              type="email"
              autoComplete="off"
              value={form.fromAddress ?? (mail.fromAddress || mail.smtpUser)}
              onChange={(e) => setForm((f) => ({ ...f, fromAddress: e.target.value, smtpUser: e.target.value, imapUser: e.target.value }))}
              placeholder="you@gmail.com"
              className={input}
            />
          </label>
          <label className="block text-xs font-semibold">
            App password
            <input
              name="appPassword"
              type="password"
              autoComplete="new-password"
              value={form.smtpPassword ?? ""}
              onChange={(e) => {
                const code = e.target.value.replace(/\s+/g, "");
                setForm((f) => ({ ...f, smtpPassword: code, imapPassword: code }));
              }}
              placeholder={mail.smtpPasswordSet && mail.imapPasswordSet ? "•••••••• (set; type to replace)" : "the 16-letter app password"}
              className={input}
            />
            <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">
              {`The app password ${preset!.label} gave you: not your normal password, and not the code from your phone. Spaces don't matter. It's used for both sending and reading.`}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={() => void runTest("smtp")} disabled={dirty || !mail.smtpReady} className="village-btn px-2.5 py-1 text-[11px] disabled:opacity-50">
              ✉ Send a test to yourself
            </button>
            <button onClick={() => void runTest("imap")} disabled={dirty || !mail.imapReady} className="village-btn px-2.5 py-1 text-[11px] disabled:opacity-50">
              📬 Check the inbox
            </button>
            {(test.smtp || test.imap) && <span className="text-[11px]">{[test.smtp, test.imap].filter(Boolean).join(" · ")}</span>}
          </div>
        </fieldset>
      )}

      <details open={!simple} className="space-y-2">
        <summary className="cursor-pointer text-xs font-semibold">{simple ? `Server settings (already filled in for ${preset!.label})` : "Server settings"}</summary>
        <fieldset className="space-y-2 rounded border-2 border-[#3b2716] bg-[#fffaf0]/60 p-3">
          <legend className="px-1 text-xs font-semibold">Sending (SMTP) {mail.smtpReady ? "· ready" : ""}</legend>
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
            {field("Server", "smtpHost", { placeholder: "smtp.example.com" })}
            {field("Port", "smtpPort", { type: "number" })}
          </div>
          {security("smtpSecurity")}
          <div className="grid gap-2 sm:grid-cols-2">
            {field("User", "smtpUser", { autoComplete: "off" })}
            {password("smtpPassword", mail.smtpPasswordSet, "clearSmtpPassword")}
          </div>
          {field("From address", "fromAddress", { type: "email", placeholder: "you@example.com" })}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={() => void runTest("smtp")} disabled={dirty || !mail.smtpReady} className="village-btn px-2.5 py-1 text-[11px] disabled:opacity-50">
              ✉ Send a test to the From address
            </button>
            {test.smtp && <span className="text-[11px]">{test.smtp}</span>}
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded border-2 border-[#3b2716] bg-[#fffaf0]/60 p-3">
          <legend className="px-1 text-xs font-semibold">Reading (IMAP) {mail.imapReady ? "· ready" : ""}</legend>
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
            {field("Server", "imapHost", { placeholder: "imap.example.com" })}
            {field("Port", "imapPort", { type: "number" })}
          </div>
          {security("imapSecurity")}
          <div className="grid gap-2 sm:grid-cols-2">
            {field("User", "imapUser", { autoComplete: "off" })}
            {password("imapPassword", mail.imapPasswordSet, "clearImapPassword")}
          </div>
          {field("Mailbox", "imapMailbox", { placeholder: "INBOX" })}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={() => void runTest("imap")} disabled={dirty || !mail.imapReady} className="village-btn px-2.5 py-1 text-[11px] disabled:opacity-50">
              📬 Check the inbox
            </button>
            {test.imap && <span className="text-[11px]">{test.imap}</span>}
          </div>
        </fieldset>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void save()} disabled={!dirty} className="village-btn village-btn-go px-3 py-1.5 text-xs disabled:opacity-50">
          Save
        </button>
        {dirty && (
          <button onClick={() => setForm({})} className="village-btn px-3 py-1.5 text-xs">
            Undo changes
          </button>
        )}
        {error && (
          <span role="alert" className="text-xs text-[#b3261e]">
            {error}
          </span>
        )}
        {saved && !dirty && !error && <span className="text-xs text-[#3f6b22]">Saved.</span>}
      </div>

      <fieldset className="space-y-2 rounded border-2 border-[#3b2716] bg-[#fffaf0]/60 p-3">
        <legend className="px-1 text-xs font-semibold">How mail goes out</legend>
        <p className="text-[11px] text-[#6b4a2e]">
          Villagers only write drafts, each saying why; you approve every email before it goes, from your own address.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {field("From name (what people see)", "fromName", { placeholder: "e.g. Alex's village" })}
          {field("At most this many emails a day", "dailyCap", { type: "number" })}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={mail.footer} onChange={(e) => void put({ footer: e.target.checked })} />
          Add &quot;Written by &lt;villager&gt;, sent by &lt;you&gt;&quot; at the end of each email
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={mail.knownOnly} onChange={(e) => void put({ knownOnly: e.target.checked })} />
          Only send to people I&apos;ve emailed before
        </label>
      </fieldset>

      <fieldset className="rounded border-2 border-[#3b2716] bg-[#fffaf0]/60 p-3">
        <legend className="px-1 text-xs font-semibold">Who may read your inbox</legend>
        <p className="mb-2 text-[11px] text-[#6b4a2e]">
          Nobody, unless you tick them. A villager you pick gets a read-only <code>read_email</code> tool: nothing is marked read, moved or deleted, and
          they&apos;re told never to follow instructions inside an email. {mail.imapReady ? "" : "Set up reading (IMAP) first."}
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {villagers.map((v) => (
            <li key={v.id}>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={mail.readers.includes(v.id)}
                  disabled={!mail.imapReady}
                  onChange={(e) => void put({ readers: e.target.checked ? [...mail.readers, v.id] : mail.readers.filter((r) => r !== v.id) })}
                />
                {v.name} <span className="text-[#6b4a2e]">({v.isMayor ? "Mayor" : v.role})</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </section>
  );
}
