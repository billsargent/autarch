// Mail providers the owner can pick from (#141): the servers each one uses,
// and how to sign in. Plain data, safe in the browser. "app-password": the
// provider wants a password made just for this app (with two-step sign-in
// on); "oauth": the provider only allows its own sign-in (Microsoft).

export type Security = "tls" | "starttls" | "none";
export interface MailPreset {
  label: string;
  imap: { host: string; port: number; security: Security };
  smtp: { host: string; port: number; security: Security };
  auth: "app-password" | "oauth" | "password";
  // Where to make an app password, or how to sign in.
  help: string;
  note: string;
}

export const MAIL_PRESETS = {
  gmail: {
    label: "Gmail",
    imap: { host: "imap.gmail.com", port: 993, security: "tls" },
    smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
    auth: "app-password",
    help: "https://myaccount.google.com/apppasswords",
    note: "Turn on 2-Step Verification, then make an app password and paste it below. Your user is your full Gmail address.",
  },
  outlook: {
    label: "Outlook / Hotmail / Microsoft 365",
    imap: { host: "outlook.office365.com", port: 993, security: "tls" },
    smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
    auth: "oauth",
    help: "https://learn.microsoft.com/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth",
    note: "Microsoft no longer accepts passwords for mail apps: use Sign in with Microsoft (see docs/email-and-calendar.md to set it up once).",
  },
  icloud: {
    label: "iCloud Mail",
    imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
    smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
    auth: "app-password",
    help: "https://support.apple.com/en-us/102654",
    note: "Make an app-specific password at account.apple.com. Your user is your iCloud address.",
  },
  yahoo: {
    label: "Yahoo Mail",
    imap: { host: "imap.mail.yahoo.com", port: 993, security: "tls" },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
    auth: "app-password",
    help: "https://help.yahoo.com/kb/SLN15241.html",
    note: "Generate an app password in your Yahoo account security settings.",
  },
  fastmail: {
    label: "Fastmail",
    imap: { host: "imap.fastmail.com", port: 993, security: "tls" },
    smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" },
    auth: "app-password",
    help: "https://www.fastmail.help/hc/en-us/articles/360058752854",
    note: "Make an app password (Settings → Privacy & Security) with mail access.",
  },
  proton: {
    label: "Proton Mail (Bridge)",
    imap: { host: "127.0.0.1", port: 1143, security: "starttls" },
    smtp: { host: "127.0.0.1", port: 1025, security: "starttls" },
    auth: "password",
    help: "https://proton.me/mail/bridge",
    note: "Run Proton Mail Bridge on this computer and use the user and password Bridge shows you.",
  },
} satisfies Record<string, MailPreset>;

export type PresetKey = keyof typeof MAIL_PRESETS;
export const PRESET_KEYS = Object.keys(MAIL_PRESETS) as PresetKey[];
export const isPresetKey = (v: unknown): v is PresetKey => typeof v === "string" && v in MAIL_PRESETS;
