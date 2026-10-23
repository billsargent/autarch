// Tests for villagers (#55, #56): the Mayor made from an old install, adding
// villagers, and turns that run as their villager — name, personality, model,
// tools, and the things they create. Runs against a throwaway database and the
// fake model. Run with: npm run test:villagers
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeModel } from "./lib/fakeModel";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autarch-villagers-"));
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

const req = (url: string, method: string, body?: unknown) =>
  new Request(`http://test${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

async function main() {
  const { db } = await import("../src/db");
  const { agents, conversations, goals, jobs, journalEntries, notifications, toolExecutions } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { updateSettings, getSettings } = await import("../src/lib/agent/settingsStore");
  const villagers = await import("../src/lib/agent/agents");
  const { runAgentTurn } = await import("../src/lib/agent/runner");
  const agentsRoute = await import("../src/app/api/agents/route");
  const agentRoute = await import("../src/app/api/agents/[id]/route");
  const settingsRoute = await import("../src/app/api/settings/route");
  const jobsRoute = await import("../src/app/api/jobs/route");
  const runsRoute = await import("../src/app/api/jobs/[id]/runs/route");

  // --- an install from before villagers --------------------------------------------
  await getSettings();
  await updateSettings({ agentName: "Ada", persona: "A cheerful baker." });
  const [oldConv] = await db.insert(conversations).values({ title: "old chat" }).returning();
  const [oldJob] = await db.insert(jobs).values({ name: "old job" }).returning();
  const [oldGoal] = await db.insert(goals).values({ title: "old goal" }).returning();
  const mayor = await villagers.ensureMayor();
  check("the old agent becomes the Mayor, keeping its name and personality", [mayor.name, mayor.persona, mayor.isMayor, mayor.role], ["Ada", "A cheerful baker.", true, "Mayor"]);
  check("…in the Mayor's robes, living in the workspace itself", [mayor.character, mayor.home], ["master", ""]);
  check("…and what the old agent had is the Mayor's", [
    (await db.select().from(conversations).where(eq(conversations.id, oldConv.id)))[0].agentId,
    (await db.select().from(jobs).where(eq(jobs.id, oldJob.id)))[0].agentId,
  ], [mayor.id, mayor.id]);
  check("…while goals stay town goals", (await db.select().from(goals).where(eq(goals.id, oldGoal.id)))[0].agentId, null);
  check("asking again doesn't make a second Mayor", (await villagers.ensureMayor()).id, mayor.id);

  // --- the owner's settings screens edit the Mayor --------------------------------
  await settingsRoute.PUT(req("/api/settings", "PUT", { agentName: "Mayor Ada" }));
  check("renaming the agent in Settings renames the Mayor", (await villagers.ensureMayor()).name, "Mayor Ada");
  const shown = await (await settingsRoute.GET()).json();
  check("…and Settings shows the Mayor's name", shown.settings.agentName, "Mayor Ada");

  // --- adding villagers --------------------------------------------------------------
  const tools = (await import("../src/lib/agent/tools")).ALL_TOOL_DEFINITIONS.map((t) => t.function.name);
  check("a villager needs a name", villagers.validateAgentInput({}, tools, true), { ok: false, error: "name: is required." });
  check("an unknown look is refused", villagers.validateAgentInput({ name: "x", character: "dragon" }, tools, true).ok, false);
  check("an unknown tool is refused", villagers.validateAgentInput({ name: "x", enabledTools: ["fly"] }, tools, true).ok, false);
  check("a budget must be a sensible number", villagers.validateAgentInput({ name: "x", dailyBudgetUsd: -1 }, tools, true).ok, false);

  const add = async (body: Record<string, unknown>) => (await agentsRoute.POST(req("/api/agents", "POST", body))).json();
  const tom = (
    await add({
      name: "Tom",
      role: "Fisherman",
      persona: "A grumpy old fisherman who loves puns.",
      model: "tom-model",
      enabledTools: ["read_file", "list_directory", "update_journal", "manage_goal", "list_goals", "notify_human", "run_shell_command"],
    })
  ).agent;
  check("a new villager gets a home folder of their own", tom.home, "villagers/tom");
  check("…a look that isn't the Mayor's", tom.character !== "master", true);
  check("…and a colour nobody else has", tom.color !== mayor.color, true);
  const tom2 = (await add({ name: "Tom" })).agent;
  check("two villagers with one name get different homes", tom2.home, "villagers/tom-2");
  const list = (await (await agentsRoute.GET()).json()).agents;
  check("the village lists everyone with what they're up to", list.map((a: { name: string; working: boolean }) => [a.name, a.working]), [["Mayor Ada", false], ["Tom", false], ["Tom", false]]);

  // --- turns run as their villager ---------------------------------------------------
  const fake = startFakeModel();
  const port = await fake.listen();
  await updateSettings({
    apiKey: "test-key",
    apiBaseUrl: `http://127.0.0.1:${port}`,
    workspaceDir: path.join(tmp, "ws"),
    autonomyMode: "autonomous",
    modelName: "town-model",
    // The town's tool policy leaves out run_shell_command.
    enabledTools: tools.filter((t) => t !== "run_shell_command"),
  });

  fake.script.push(
    {
      tools: [
        { name: "update_journal", args: { title: "Caught a big one" } },
        { name: "manage_goal", args: { title: "Mend the nets" } },
        { name: "notify_human", args: { title: "Fish for supper" } },
      ],
    },
    { text: "Done, and no carp about it." },
  );
  const { conversationId: tomChat } = await runAgentTurn({ userMessage: "hello Tom", agentId: tom.id });
  const step = fake.seen.find((s) => s.stream)!;
  check("a new conversation with Tom is Tom's", (await db.select().from(conversations).where(eq(conversations.id, tomChat)))[0].agentId, tom.id);
  check("the model is told it's Tom the fisherman", step.system.startsWith("You are Tom, the village's fisherman. A grumpy old fisherman who loves puns."), true);
  check("…that his folder is his own", step.system.includes(`Your own folder is "${path.join(tmp, "ws")}/villagers/tom"`), true);
  check("…and who his neighbours are", step.system.includes("YOUR NEIGHBOURS") && step.system.includes("Mayor Ada (Mayor)"), true);
  check("Tom's turn uses Tom's model", step.model, "tom-model");
  check("Tom only gets his tools, and never beyond the town's policy", step.tools.sort(), ["list_directory", "list_goals", "manage_goal", "notify_human", "read_file", "update_journal"]);
  check("his diary entry is his", (await db.select().from(journalEntries).where(eq(journalEntries.title, "Caught a big one")))[0]?.agentId, tom.id);
  check("his goal is his", (await db.select().from(goals).where(eq(goals.title, "Mend the nets")))[0]?.agentId, tom.id);
  const letter = (await db.select().from(notifications).where(eq(notifications.title, "Fish for supper")))[0];
  check("his letter is signed by him", [letter?.agentId, letter?.source], [tom.id, "Tom"]);
  check("his tool calls are recorded as his", (await db.select().from(toolExecutions).where(eq(toolExecutions.conversationId, tomChat))).every((e) => e.agentId === tom.id), true);

  // The Mayor's turn uses the town model and doesn't see Tom's goal.
  await db.insert(goals).values({ title: "The Mayor's own goal", agentId: mayor.id });
  fake.script.push({ tools: [{ name: "list_goals", args: {} }] }, { text: "ok" });
  const { conversationId: mayorChat } = await runAgentTurn({ eventNote: "work", trigger: "scheduled" });
  const mayorStep = fake.seen.filter((s) => s.stream).at(-2)!;
  check("a conversation with no villager named is the Mayor's", (await db.select().from(conversations).where(eq(conversations.id, mayorChat)))[0].agentId, mayor.id);
  check("the Mayor's turn uses the town model", mayorStep.model, "town-model");
  const listed = (await db.select().from(toolExecutions).where(eq(toolExecutions.conversationId, mayorChat)))[0];
  check("the Mayor's goal list has his goals and the town's, not Tom's", [listed.output?.includes("The Mayor's own goal"), listed.output?.includes("old goal"), listed.output?.includes("Mend the nets")], [true, true, false]);

  // Jobs run as the job's villager.
  const job = (await (await jobsRoute.POST(req("/api/jobs", "POST", { name: "Check the nets", agentId: tom.id }))).json()).job;
  check("a job can belong to a villager", job.agentId, tom.id);
  fake.script.push({ text: "Nets look fine." });
  await runsRoute.POST(req(`/api/jobs/${job.id}/runs`, "POST"), { params: Promise.resolve({ id: String(job.id) }) });
  await new Promise((r) => setTimeout(r, 1500));
  const ran = (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0];
  check("running Tom's job opens a conversation with Tom", (await db.select().from(conversations).where(eq(conversations.id, ran.conversationId!)))[0].agentId, tom.id);
  check("…and the turn ran as Tom", fake.lastStep()!.system.startsWith("You are Tom"), true);

  // --- pausing and dismissing -------------------------------------------------------
  await agentRoute.PATCH(req(`/api/agents/${tom.id}`, "PATCH", { status: "paused" }), { params: Promise.resolve({ id: String(tom.id) }) });
  fake.script.push({ tools: [{ name: "read_file", args: { path: "x.txt" } }] }, { text: "I'm resting." });
  await runAgentTurn({ conversationId: tomChat, userMessage: "read something" });
  const blocked = (await db.select().from(toolExecutions).where(eq(toolExecutions.conversationId, tomChat))).at(-1);
  check("a paused villager can chat but their tools are blocked", [blocked?.tool, blocked?.status], ["read_file", "blocked"]);
  check("…and the model is told they're paused", fake.lastStep()!.system.includes("The human has paused you"), true);

  const mayorGone = await agentRoute.DELETE(req(`/api/agents/${mayor.id}`, "DELETE"), { params: Promise.resolve({ id: String(mayor.id) }) });
  check("the Mayor can't be dismissed", mayorGone.status, 409);
  await agentRoute.DELETE(req(`/api/agents/${tom.id}`, "DELETE"), { params: Promise.resolve({ id: String(tom.id) }) });
  check("a dismissed villager leaves the list", (await villagers.listVillagers()).map((a) => a.name), ["Mayor Ada", "Tom"]);
  check("…their jobs stop", (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].enabled, false);
  let refused = "";
  try {
    await runAgentTurn({ conversationId: tomChat, userMessage: "hello?" });
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }
  check("…and nobody can talk to them any more", refused.includes("left the village"), true);
  check("…but what they did stays on record", (await db.select().from(agents).where(eq(agents.id, tom.id)))[0].status, "dismissed");

  // --- budgets (#60) -------------------------------------------------------------------
  const { workSessions } = await import("../src/db/schema");
  const chatRoute = await import("../src/app/api/chat/route");
  const ann = (await add({ name: "Ann", dailyBudgetUsd: 0.000001 })).agent;
  fake.script.push(
    { tools: [{ name: "list_directory", args: { path: "." } }] },
    { tools: [{ name: "list_directory", args: { path: "." } }] },
    { text: "never reached" },
  );
  const { conversationId: annChat } = await runAgentTurn({ userMessage: "busy day?", agentId: ann.id });
  const annMsgs = await db.select().from((await import("../src/db/schema")).messages).where(eq((await import("../src/db/schema")).messages.conversationId, annChat));
  check("a turn that spends the day's budget stops at the next step", annMsgs.some((m) => m.content?.startsWith("[BUDGET] Ann has spent today's budget")), true);
  const annSession = (await db.select().from(workSessions).where(eq(workSessions.conversationId, annChat)))[0];
  check("…recorded as stopped for the budget", [annSession.status, annSession.reason], ["terminated", "budget reached"]);
  check("…and what she spent counts towards today", villagers.spentToday(ann.id) > 0, true);
  const before = annMsgs.length;
  let budgetErr: unknown = null;
  try {
    await runAgentTurn({ conversationId: annChat, userMessage: "one more?" });
  } catch (err) {
    budgetErr = err;
  }
  check("her next turn is refused with the reason", budgetErr instanceof villagers.BudgetError && /spent today's budget/.test((budgetErr as Error).message), true);
  check("…before anything is written", (await db.select().from((await import("../src/db/schema")).messages).where(eq((await import("../src/db/schema")).messages.conversationId, annChat))).length, before);
  const chatRefused = await chatRoute.POST(req("/api/chat", "POST", { conversationId: annChat, message: "hi" }));
  check("chat says so straight away (429)", [chatRefused.status, (await chatRefused.json()).error?.includes("starts again at midnight")], [429, true]);

  // A villager's own hourly action limit.
  const bea = (await add({ name: "Bea", maxActionsPerHour: 1 })).agent;
  fake.script.length = 0; // Ann's turn stopped before using all its replies
  fake.script.push(
    {
      tools: [
        { name: "list_directory", args: { path: "." } },
        { name: "list_directory", args: { path: "." } },
      ],
    },
    { text: "ok" },
  );
  const { conversationId: beaChat } = await runAgentTurn({ userMessage: "look twice", agentId: bea.id });
  const beaCalls = (await db.select().from(toolExecutions).where(eq(toolExecutions.conversationId, beaChat))).map((e) => e.status);
  check("a villager's own hourly limit stops their extra actions", beaCalls, ["success", "rate_limited"]);

  // The town's budget covers everyone.
  await settingsRoute.PUT(req("/api/settings", "PUT", { townDailyBudgetUsd: 0.000001 }));
  let townErr = "";
  try {
    await runAgentTurn({ userMessage: "hello", agentId: bea.id });
  } catch (err) {
    townErr = err instanceof Error ? err.message : "";
  }
  check("when the village's budget is spent, everyone stops", townErr.startsWith("The village has spent today's budget"), true);
  await settingsRoute.PUT(req("/api/settings", "PUT", { townDailyBudgetUsd: "" }));
  check("clearing the town budget removes the cap", (await getSettings()).townDailyBudgetUsd, null);

  // --- villagers asking each other (#57) -----------------------------------------
  const { messages: messagesT } = await import("../src/db/schema");
  const { askVillager } = await import("../src/lib/agent/messaging");
  const cal = (await add({ name: "Cal", role: "Carpenter" })).agent;
  const dot = (await add({ name: "Dot", role: "Gardener" })).agent;
  const msgsOf = async (id: number) => db.select().from(messagesT).where(eq(messagesT.conversationId, id)).orderBy(messagesT.id);
  const waitFor = async (id: number, start: string) => {
    for (let i = 0; i < 50; i++) {
      const hit = (await msgsOf(id)).find((m) => m.content?.startsWith(start));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };
  // Make it daytime whatever the real clock says: nobody can be asked at night.
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const hmNow = new Date();
  await updateSettings({ bedtime: hm(new Date(hmNow.getTime() + 2 * 3600_000)), wakeTime: hm(new Date(hmNow.getTime() + 3 * 3600_000)) });
  fake.script.length = 0;
  fake.byAgent.Cal = [{ tools: [{ name: "ask_villager", args: { to: "dot", message: "Where are the nets?" } }] }, { text: "I've asked Dot." }];
  fake.byAgent.Dot = [{ text: "In the shed by the pond." }];
  const { conversationId: calChat } = await runAgentTurn({ userMessage: "find the nets", agentId: cal.id });
  const sent = (await msgsOf(calChat)).find((m) => m.role === "tool" && m.toolName === "ask_villager");
  check("asking a neighbour sends the question (names are matched loosely)", sent?.content?.startsWith("Sent to Dot."), true);
  const reply = await waitFor(calChat, "[Reply from Dot]");
  check("the answer comes back to the asker's conversation", reply?.content, "[Reply from Dot] In the shed by the pond.");
  const [thread] = await db.select().from(conversations).where(eq(conversations.partnerAgentId, cal.id));
  check("the thread is Dot's, with Cal as partner", [thread?.agentId, thread?.title], [dot.id, "Cal ↔ Dot"]);
  check("…holding the question and her answer", (await msgsOf(thread.id)).map((m) => m.content), ["[Cal asks] Where are the nets?", "In the shed by the pond."]);
  const dotSession = (await db.select().from(workSessions).where(eq(workSessions.conversationId, thread.id)))[0];
  check("Dot answered in her own turn", [dotSession.agentId, dotSession.trigger], [dot.id, "message"]);
  check("…told that a neighbour asked", fake.seen.some((s) => s.system.startsWith("You are Dot") && s.system.includes("A neighbour has asked you")), true);
  check("the answer doesn't start a new turn for Cal", (await db.select().from(workSessions).where(eq(workSessions.conversationId, calChat))).length, 1);

  // No asking onward while answering.
  fake.byAgent.Cal = [{ tools: [{ name: "ask_villager", args: { to: "Dot", message: "And the oars?" } }] }, { text: "ok" }];
  fake.byAgent.Dot = [{ tools: [{ name: "ask_villager", args: { to: "Cal", message: "Why do you ask?" } }] }, { text: "Also in the shed." }];
  await runAgentTurn({ conversationId: calChat, userMessage: "and the oars?" });
  await waitFor(calChat, "[Reply from Dot] Also in the shed.");
  const onward = (await msgsOf(thread.id)).find((m) => m.role === "tool" && m.toolName === "ask_villager");
  check("someone answering can't send questions onward", onward?.content?.startsWith("Refused: you're answering a neighbour"), true);

  // The pair limit, and the other refusals (called directly: no model needed).
  const ctxCal = { agentId: cal.id, agentName: "Cal", conversationId: calChat };
  await db.insert(messagesT).values([
    { conversationId: thread.id, role: "event", content: "[Cal asks] 3" },
    { conversationId: thread.id, role: "event", content: "[Cal asks] 4" },
  ]);
  check(`a pair is limited to a few questions an hour`, (await askVillager({ to: "Dot", message: "5?" }, ctxCal)).output.includes("4 times in the last hour"), true);
  check("nobody by that name", (await askVillager({ to: "Zed", message: "hi" }, ctxCal)).output.startsWith('Refused: nobody called "Zed"'), true);
  check("not yourself", (await askVillager({ to: "Cal", message: "hi" }, ctxCal)).output, "Refused: that's you.");
  await agentRoute.PATCH(req(`/api/agents/${ann.id}`, "PATCH", { status: "paused" }), { params: Promise.resolve({ id: String(ann.id) }) });
  check("not someone who's paused", (await askVillager({ to: "Ann", message: "hi" }, ctxCal)).output.includes("resting"), true);
  await updateSettings({ bedtime: hm(new Date(hmNow.getTime() - 3600_000)), wakeTime: hm(new Date(hmNow.getTime() + 3600_000)) });
  check("not at night", (await askVillager({ to: "Bea", message: "hi" }, ctxCal)).output.includes("is asleep"), true);
  await updateSettings({ bedtime: "22:00", wakeTime: "07:00" });

  fake.close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* on Windows the database stays locked until exit */
  }
  if (failures > 0) {
    console.error(`\n${failures} villager test(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll villager tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
