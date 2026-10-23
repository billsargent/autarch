import path from "node:path";

// Where the SQLite database lives. Defaults to data/app.db in the working
// directory; AUTARCH_DB_PATH points it elsewhere (tests and browser checks use a
// throwaway file so they never touch a real install's data).
export const DB_PATH = process.env.AUTARCH_DB_PATH
  ? path.resolve(process.env.AUTARCH_DB_PATH)
  : path.join(process.cwd(), "data", "app.db");

// The database plus SQLite's WAL sidecar files.
export const DB_FILES = [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`];
