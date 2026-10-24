// Tests for the job routes: a new job keeps the report conversation it was
// given (#26), and changing a schedule re-plans the next run (#25).
// Runs against a throwaway database (AUTARCH_DB_PATH). Run with: npm run test:jobs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autarch-jobs-"));
process.env.AUTARCH_DB_PATH = path.join(tmp, "test.db");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`✓ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
}

const json = (body: unknown) => new Request("http://test/api/jobs", { method: "POST", body: JSON.stringify(body) });
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function main() {
  // Load everything that touches the database only after AUTARCH_DB_PATH is set.
  const { db } = await import("../src/db");
  const { conversations } = await import("../src/db/schema");
  const jobsRoute = await import("../src/app/api/jobs/route");
  const jobRoute = await import("../src/app/api/jobs/[id]/route");
  const { nextCronRun } = await import("../src/lib/agent/cron");

  const [conv] = await db.insert(conversations).values({ title: "Reports" }).returning();

  // --- #26: a new job reports where it was told to ------------------------------
  const create = async (body: Record<string, unknown>) => (await (await jobsRoute.POST(json(body))).json()).job;
  check("a new job keeps its report conversation", (await create({ name: "a", conversationId: String(conv.id) })).conversationId, conv.id);
  check("no conversation means auto-create", (await create({ name: "b", conversationId: "" })).conversationId, null);
  check("an unknown conversation falls back to auto-create", (await create({ name: "c", conversationId: 99999 })).conversationId, null);

  // --- #25: a schedule change moves the next run ---------------------------------
  const job = await create({ name: "d", intervalMinutes: 600 });
  const patch = async (body: Record<string, unknown>) =>
    (await (await jobRoute.PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify(body) }), params(job.id))).json()).job;
  const at = (j: { nextRunAt: string | Date }) => new Date(j.nextRunAt).getTime();
  const minutesAway = (j: { nextRunAt: string | Date }) => Math.round((at(j) - Date.now()) / 60_000);

  check("a new interval job runs one interval from now", minutesAway(job), 600);
  const cronJob = await patch({ cron: "0 9 * * *" });
  check("setting a cron moves the next run to the cron's next time", at(cronJob), nextCronRun("0 9 * * *", new Date())!.getTime());
  const renamed = await patch({ name: "d2", cron: "0 9 * * *", intervalMinutes: 600 });
  check("saving the same schedule leaves the next run alone", at(renamed), at(cronJob));
  const cleared = await patch({ cron: null, intervalMinutes: 30 });
  check("clearing the cron goes back to the interval", [cleared.cron, minutesAway(cleared)], [null, 30]);
  const longer = await patch({ intervalMinutes: 90 });
  check("a new interval re-plans from now", minutesAway(longer), 90);

  // --- #24: cron expressions are checked, with a reason --------------------------
  const { cronProblem } = await import("../src/lib/agent/cron");
  for (const ok of ["*/15 * * * *", "30 3 * * 1", "0 9-17 * * 1-5", "0 0 1,15 * *", "5/20 * * * *", "0 12 * * 7", "0 0 29 2 *"]) {
    check(`"${ok}" is accepted`, cronProblem(ok), null);
  }
  const bad: Array<[string, string]> = [
    ["hello", "5 fields"],
    ["* * * *", "5 fields"],
    ["61 * * * *", "between 0 and 59"],
    ["* 24 * * *", "between 0 and 23"],
    ["* * 0 * *", "between 1 and 31"],
    ["* * * 13 *", "between 1 and 12"],
    ["* * * * 8", "between 0 and 7"],
    ["*/0 * * * *", "step of 0"],
    ["10-5 * * * *", "backwards"],
    ["a * * * *", "isn't a number"],
    ["1,,2 * * * *", "isn't a number"],
    ["0 0 31 2 *", "never comes round"],
  ];
  for (const [expr, why] of bad) {
    check(`"${expr}" is refused (${why})`, cronProblem(expr)?.includes(why), true);
  }
  const badPost = await jobsRoute.POST(json({ name: "bad", cron: "61 * * * *" }));
  check("creating a job with a bad cron is a 400", [badPost.status, (await badPost.json()).error?.includes("between 0 and 59")], [400, true]);
  const badPatch = await jobRoute.PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ cron: "nope" }) }), params(job.id));
  check("changing a job to a bad cron is a 400", badPatch.status, 400);
  const { executeTool } = await import("../src/lib/agent/tools");
  const { getSettings } = await import("../src/lib/agent/settingsStore");
  const refusedTool = await executeTool("schedule_job", { name: "agent job", cron: "99 * * * *" }, await getSettings(), {});
  check("the agent's schedule_job refuses a bad cron", refusedTool.output.startsWith("Refused"), true);

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* on Windows the database stays locked until exit */
  }
  if (failures > 0) {
    console.error(`\n${failures} job test(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll job tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
