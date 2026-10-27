// `npm run dev`: the web app and the background worker together, as they run
// in production (deploy/autarch-web.service and autarch-worker.service).
// Each line of output is labelled [web] or [worker]; the worker restarts when
// its code changes. Stopping one (or Ctrl+C) stops both.
// Extra arguments go to `next dev`, e.g. `npm run dev -- -p 3001`.
import { spawn } from "node:child_process";

// The database driver is a native module built for one Node version: after a
// Node upgrade it has to be rebuilt, or nothing can open the database.
try {
  const { createRequire } = await import("node:module");
  const Database = createRequire(import.meta.url)("better-sqlite3");
  new Database(":memory:").close();
} catch (err) {
  console.error(`\nThe database driver doesn't work with this Node (${process.version}): ${String(err?.message ?? err).split("\n")[0]}`);
  console.error("Run `npm rebuild better-sqlite3` (or switch back to the Node version it was installed with), then try again.\n");
  process.exit(1);
}

const extra = process.argv.slice(2).join(" ");
const parts = [
  { name: "web", color: "\x1b[36m", cmd: `npx next dev ${extra}`.trim() },
  { name: "worker", color: "\x1b[35m", cmd: "npx tsx watch --clear-screen=false src/worker/index.ts" },
];

const children = [];
let stopping = false;

// Stop a child and everything it started (a shell, npx, then the real
// process): on Windows killing the shell alone leaves the rest running.
function stop(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) stop(c);
  setTimeout(() => process.exit(code), 3000).unref();
}

for (const p of parts) {
  // A shell, so npx resolves on every platform (npx.cmd on Windows).
  const child = spawn(p.cmd, { shell: true, stdio: ["inherit", "pipe", "pipe"], env: process.env });
  children.push(child);
  const label = `${p.color}[${p.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk.toString()).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) out.write(label + line + "\n");
    });
    stream.on("end", () => rest && out.write(label + rest + "\n"));
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!stopping) {
      process.stderr.write(`${label}stopped (exit ${code}); stopping the rest.\n`);
      stopAll(code ?? 1);
    }
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stopAll(0));
