import { sqlite } from "@/db";

// Kept apart from email.ts so agents.ts can ask without loading the mail
// libraries (#124).

// The villagers allowed to read the inbox, when reading is set up at all.
// Synchronous: effectiveTools (agents.ts) asks on every turn.
export function mailReaders(): number[] {
  try {
    const row = sqlite.prepare("SELECT readers, imap_host, imap_user, imap_password FROM mail_settings WHERE id = 1").get() as
      | { readers: string; imap_host: string | null; imap_user: string | null; imap_password: string | null }
      | undefined;
    if (!row?.imap_host || !row.imap_user || !row.imap_password) return [];
    const ids = JSON.parse(row.readers);
    return Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

// The villagers allowed to read the owner's calendar (#142), when there is one
// (Google connected, or an ICS address).
export function calendarReaders(): number[] {
  try {
    const row = sqlite.prepare("SELECT readers, google_refresh_token AS token FROM calendar_settings WHERE id = 1").get() as { readers: string; token: string | null } | undefined;
    const ics = (sqlite.prepare("SELECT calendar_ics_url AS url FROM agent_settings LIMIT 1").get() as { url: string | null } | undefined)?.url;
    if (!row || (!row.token && !ics)) return [];
    const ids = JSON.parse(row.readers);
    return Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}
