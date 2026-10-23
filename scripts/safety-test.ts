// Safety and correctness tests for the guardrails, approvals and sessions.
// Runs against a throwaway database (AUTARCH_DB_PATH), never a real install.
// Run with: npm run test:safety
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autarch-safety-"));
process.env.AUTARCH_DB_PATH = path.join(tmp, "test.db");

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`✓ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}${detail === undefined ? "" : `\n  got ${JSON.stringify(detail)}`}`);
  }
}

async function main() {
  // Load everything that touches the database only after AUTARCH_DB_PATH is set.
  const { db } = await import("../src/db");
  const { conversations, messages, toolExecutions, workSessions, jobs } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const risk = await import("../src/lib/agent/risk");
  const { executeTool } = await import("../src/lib/agent/tools");
  const { resolveApproval, ApprovalError } = await import("../src/lib/agent/runner");
  const { updateSettings, getSettings } = await import("../src/lib/agent/settingsStore");
  const { isStale, reapStaleSessions } = await import("../src/lib/agent/sessions");
  const { default: Markdown } = await import("../src/components/Markdown");

  await getSettings();
  await updateSettings({ workspaceDir: path.join(tmp, "workspace") });
  const settings = await getSettings();

  // --- #2: package and service names can't carry commands --------------------
  const evil = ["x'; touch /tmp/pwned; echo '", "nginx; rm -rf ~", "$(id)", "a b", "`id`", "../etc"];
  for (const name of evil) {
    check(`search with "${name}" is blocked unless it's plain words`, risk.classifyPackageAction("search", [name]).risk === "blocked" || /^[A-Za-z0-9+._ -]+$/.test(name));
    check(`install "${name}" is blocked`, risk.classifyPackageAction("install", [name]).risk === "blocked");
    check(`service "${name}" is blocked`, risk.classifyServiceAction("restart", name).risk === "blocked");
  }
  check("a normal package search stays low risk", risk.classifyPackageAction("search", ["nginx"]).risk === "low");
  check("a normal package install needs approval (high)", risk.classifyPackageAction("install", ["nginx", "libssl3:amd64"]).risk === "high");
  check("a normal service restart is high", risk.classifyServiceAction("restart", "nginx.service").risk === "high");
  check("packages that aren't a list are blocked", risk.invalidPackageArgs("install", "nginx; id") !== null);
  const refused = await executeTool("manage_package", { action: "search", packages: ["x'; touch /tmp/pwned; echo '"] }, settings);
  check("manage_package refuses an injected name even if it got past the gate", refused.output.startsWith("Refused"), refused.output);
  const refusedSvc = await executeTool("manage_service", { action: "restart", service: "nginx; id" }, settings);
  check("manage_service refuses an injected name", refusedSvc.output.startsWith("Refused"), refusedSvc.output);

  // --- #6: chat markdown drops dangerous HTML ---------------------------------
  const render = (md: string) => renderToStaticMarkup(createElement(Markdown, null, md));
  const attacks: Array<[string, RegExp]> = [
    ['<iframe srcdoc="<script>alert(1)</script>"></iframe>', /iframe|srcdoc/i],
    ['<iframe src="/api/files/x.html"></iframe>', /iframe/i],
    ["<script>alert(1)</script>", /<script/i],
    ['<img src=x onerror="alert(1)">', /onerror/i],
    ['<a href="javascript:alert(1)">click</a>', /javascript:/i],
    ["<style>body{display:none}</style>", /<style/i],
    ['<object data="x.swf"></object>', /<object/i],
    ['<form action="/api/settings"><button>go</button></form>', /<form/i],
    ['<meta http-equiv="refresh" content="0;url=/">', /<meta/i],
  ];
  for (const [html, bad] of attacks) {
    const out = render(`hello\n\n${html}`);
    check(`markdown drops ${html.slice(0, 40)}`, !bad.test(out), out);
  }
  const media = render('![shot](/api/files/screenshots/a.png)\n\n<video src="/api/files/a.mp4" controls></video>\n\n<audio src="/api/files/a.mp3" controls></audio>\n\n```ts\nconst x = 1;\n```');
  check("images from the workspace still render", media.includes('src="/api/files/screenshots/a.png"'), media);
  check("video still renders with controls", /<video[^>]*src="\/api\/files\/a.mp4"/.test(media) && media.includes("controls"), media);
  check("audio still renders", /<audio[^>]*src="\/api\/files\/a.mp3"/.test(media), media);
  check("code blocks keep their language", media.includes("language-ts"), media);

  // --- #10: query_database is read-only and can't read the key ----------------
  await updateSettings({ apiKey: "sk-test-secret" });
  const q = (sql: string) => executeTool("query_database", { sql }, settings).then((r) => r.output);
  check("a normal select works", (await q("select count(*) as n from conversations")).includes('"n"'));
  check("select * redacts the key", !(await q("select * from agent_settings")).includes("sk-test-secret"));
  check("an aliased key column is refused", (await q("select api_key as k from agent_settings")).includes("not allowed"));
  check("a key wrapped in a function is refused", (await q("select hex(api_key) from agent_settings")).includes("not allowed"));
  check("a write hidden in a CTE is refused", (await q("with x as (select 1) delete from goals")).includes("Only read-only"));
  check("a pragma statement is refused", (await q("pragma journal_mode = delete")).includes("Only read-only"));
  check("attach is refused", (await q("attach database 'x.db' as y")).includes("Only read-only"));
  await updateSettings({ apiKey: null });

  // --- #5 / #15 / #16 / #17 / #85: approvals -----------------------------------
  async function pendingRequest() {
    const [c] = await db.insert(conversations).values({ title: "t" }).returning();
    const [assistant] = await db.insert(messages).values({ conversationId: c.id, role: "assistant", content: "Let me note that." }).returning();
    const [exec] = await db
      .insert(toolExecutions)
      .values({ conversationId: c.id, messageId: assistant.id, tool: "update_journal", input: { title: "approved entry" }, status: "awaiting_approval", riskLevel: "high" })
      .returning();
    const [tool] = await db
      .insert(messages)
      .values({ conversationId: c.id, role: "tool", toolName: "update_journal", content: `PENDING HUMAN APPROVAL (execution #${exec.id}, risk=high): test` })
      .returning();
    return { c, assistant, exec, tool };
  }
  const read = async (id: number) => (await db.select().from(messages).where(eq(messages.id, id)))[0];
  const execRow = async (id: number) => (await db.select().from(toolExecutions).where(eq(toolExecutions.id, id)))[0];

  {
    const { c, assistant, exec, tool } = await pendingRequest();
    const results = await Promise.allSettled([resolveApproval(exec.id, "approved"), resolveApproval(exec.id, "approved")]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const conflict = results.filter((r) => r.status === "rejected" && r.reason instanceof ApprovalError && r.reason.status === 409).length;
    check("two simultaneous approvals run the action once (#16)", ok === 1 && conflict === 1, results.map((r) => r.status));
    check("the approved action ran", (await execRow(exec.id)).status === "approved");
    check("the outcome rewrites the tool message (#15)", (await read(tool.id)).content!.startsWith("APPROVED"), (await read(tool.id)).content);
    check("the assistant's own words are untouched (#15)", (await read(assistant.id)).content === "Let me note that.");
    // No API key, so the background follow-up turn fails; that must show up in
    // the conversation without affecting the saved decision (#85).
    await new Promise((r) => setTimeout(r, 1500));
    const events = await db.select().from(messages).where(eq(messages.conversationId, c.id));
    check("a failed follow-up turn is reported in the conversation (#85)", events.some((m) => m.content?.startsWith("[FOLLOW-UP FAILED]")));
  }
  {
    const { exec } = await pendingRequest();
    await updateSettings({ paused: true });
    let status = 0;
    try {
      await resolveApproval(exec.id, "approved");
    } catch (err) {
      status = err instanceof ApprovalError ? err.status : -1;
    }
    check("approving while paused is refused (#17)", status === 409);
    check("…and the request is still waiting (#17)", (await execRow(exec.id)).status === "awaiting_approval");
    await updateSettings({ paused: false });
  }
  {
    const { exec, tool } = await pendingRequest();
    await resolveApproval(exec.id, "denied", "not now");
    check("a denial is recorded", (await execRow(exec.id)).status === "denied");
    check("a denial rewrites the tool message with the reason", (await read(tool.id)).content!.includes("Reason: not now"));
  }
  {
    // Older executions pointed at the assistant message; the rewrite still finds the tool message.
    const { assistant, exec, tool } = await pendingRequest();
    check("legacy execution points at the assistant message", exec.messageId === assistant.id);
    await resolveApproval(exec.id, "denied");
    check("legacy approvals still rewrite the right message", (await read(tool.id)).content!.startsWith("DENIED") && (await read(assistant.id)).content === "Let me note that.");
  }

  // --- #7: agent-written files are served inert ------------------------------
  {
    const { GET } = await import("../src/app/api/files/[...path]/route");
    fs.mkdirSync(path.join(tmp, "workspace"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "workspace", "page.html"), "<script>fetch('/api/settings')</script>");
    fs.writeFileSync(path.join(tmp, "workspace", "pic.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const get = (name: string) => GET(new Request(`http://x/api/files/${name}`), { params: Promise.resolve({ path: [name] }) });
    const html = await get("page.html");
    check("agent-written HTML is served as plain text (#7)", (html.headers.get("content-type") ?? "").startsWith("text/plain"), html.headers.get("content-type"));
    const svg = await get("pic.svg");
    const csp = svg.headers.get("content-security-policy") ?? "";
    check("files are served sandboxed, so scripts can't run (#7)", csp.includes("sandbox") && !csp.includes("allow-scripts"), csp);
    check("files are served with nosniff (#7)", svg.headers.get("x-content-type-options") === "nosniff");
  }

  // --- #23: stale running sessions are cleaned up -----------------------------
  const now = new Date("2026-10-23T12:00:00Z");
  check("a session within its time isn't stale", !isStale(new Date(now.getTime() - 20 * 60_000), now, 10));
  check("a session far past its time is stale", isStale(new Date(now.getTime() - 60 * 60_000), now, 10));
  await updateSettings({ maxSessionMinutes: 10 });
  const [job] = await db.insert(jobs).values({ name: "j", maxDurationMinutes: 10, lastStatus: "running" }).returning();
  const [old] = await db.insert(workSessions).values({ trigger: "scheduled", jobId: job.id, startedAt: new Date(Date.now() - 3 * 3600_000) }).returning();
  const [fresh] = await db.insert(workSessions).values({ trigger: "chat", startedAt: new Date() }).returning();
  const reaped = await reapStaleSessions();
  check("the reaper cleans up the stale session", reaped === 1);
  check("…marking it failed", (await db.select().from(workSessions).where(eq(workSessions.id, old.id)))[0].status === "failed");
  check("…and leaves a live one alone", (await db.select().from(workSessions).where(eq(workSessions.id, fresh.id)))[0].status === "running");
  check("…and clears the job's 'running'", (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].lastStatus === "interrupted");

  // Best effort: on Windows the database file stays locked until the process exits.
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* left in the OS temp folder */
  }
  if (failures > 0) {
    console.error(`\n${failures} safety test(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll safety tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
