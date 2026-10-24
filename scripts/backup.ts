// WAL-safe SQLite backup using better-sqlite3's backup API.
// A plain `cp app.db` can capture an inconsistent DB or miss the WAL tail;
// this produces a consistent snapshot even while the app is running.
//
// Usage: npm run backup
// Optional env vars: DB_PATH, BACKUP_DIR (default ~/backups) and
// BACKUP_KEEP_DAYS (default 14; older backups are deleted, 0 keeps all).
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SRC = process.env.DB_PATH || process.env.AUTARCH_DB_PATH || path.join(process.cwd(), "data", "app.db");
const DEST_DIR = process.env.BACKUP_DIR || path.join(os.homedir(), "backups");
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 14);

// Delete this script's own backups (app-*.db) older than KEEP_DAYS.
function prune(now = Date.now()) {
  if (!(KEEP_DAYS > 0)) return;
  for (const name of fs.readdirSync(DEST_DIR)) {
    if (!/^app-.*\.db$/.test(name)) continue;
    const file = path.join(DEST_DIR, name);
    if (now - fs.statSync(file).mtimeMs > KEEP_DAYS * 86_400_000) {
      fs.rmSync(file);
      console.log(`Removed old backup ${file}`);
    }
  }
}

async function main() {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(DEST_DIR, `app-${ts}.db`);
  const srcDb = new Database(SRC, { readonly: true });
  try {
    await srcDb.backup(dest);
  } finally {
    srcDb.close();
  }
  console.log(`Backed up ${SRC} -> ${dest}`);
  prune();
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
