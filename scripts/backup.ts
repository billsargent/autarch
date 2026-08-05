// WAL-safe SQLite backup using better-sqlite3's backup API.
// A plain `cp app.db` can capture an inconsistent DB or miss the WAL tail;
// this produces a consistent snapshot even while the app is running.
//
// Usage: npm run backup   (DB_PATH and BACKUP_DIR env vars are optional)
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SRC = process.env.DB_PATH || path.join(process.cwd(), "data", "app.db");
const DEST_DIR = process.env.BACKUP_DIR || "/root/backups";

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
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
