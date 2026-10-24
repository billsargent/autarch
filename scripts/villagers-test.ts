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

  // --- the Mayor's powers (#58) ----------------------------------------------------
  const { executeTool, ALL_TOOL_DEFINITIONS } = await import("../src/lib/agent/tools");
  const { runMayorTool, FLAGS_PER_HOUR } = await import("../src/lib/agent/mayor");
  const town = await getSettings();
  const calRow = (await db.select().from(agents).where(eq(agents.id, cal.id)))[0];
  check("nobody but the Mayor gets the Mayor's tools, even if listed for them", villagers.effectiveTools({ ...calRow, enabledTools: ["pause_agent", "read_file"] }, town), ["read_file"]);
  check("…and nobody but the Mayor was offered them", fake.seen.filter((s) => !s.system.startsWith("You are Mayor Ada")).some((s) => s.tools.includes("pause_agent")), false);
  check("a villager calling one anyway is refused when it runs", (await executeTool("pause_agent", { name: "Dot", reason: "x" }, town, ctxCal)).output, "Refused: only the Mayor can do that.");

  fake.byAgent["Mayor Ada"] = [{ tools: [{ name: "assign_goal", args: { to: "cal", title: "Fix the bridge", priority: 2 } }] }, { text: "Cal has the bridge." }];
  const { conversationId: mayorTalk } = await runAgentTurn({ userMessage: "someone should fix the bridge", agentId: mayor.id });
  const mayorSaw = fake.seen.find((s) => s.system.startsWith("You are Mayor Ada") && s.stream)!;
  check("the Mayor is offered his powers and told about them", [mayorSaw.tools.includes("pause_agent"), mayorSaw.system.includes("AS MAYOR")], [true, true]);
  const bridge = (await db.select().from(goals).where(eq(goals.title, "Fix the bridge")))[0];
  check("the Mayor can give a villager a goal", [bridge?.agentId, bridge?.priority, bridge?.conversationId], [cal.id, 2, null]);
  check("…in a real turn, logged as his", (await db.select().from(toolExecutions).where(eq(toolExecutions.conversationId, mayorTalk))).map((e) => [e.tool, e.status, e.agentId]), [["assign_goal", "success", mayor.id]]);

  const ctxMayor = { agentId: mayor.id, agentName: mayor.name, conversationId: mayorTalk };
  const power = (tool: string, args: Record<string, unknown>, ctx: Record<string, unknown> = ctxMayor) => runMayorTool(tool, args, ctx).then((r) => r.output);
  const jobOut = await power("schedule_job_for", { to: "Dot", name: "Water the beans", instruction: "Water them.", intervalMinutes: 120, jobId: bridge.id });
  const beans = (await db.select().from(jobs).where(eq(jobs.name, "Water the beans")))[0];
  check("the Mayor can schedule a job for a villager (always a new one, theirs)", [jobOut.startsWith("Scheduled for Dot: job #"), beans?.agentId, beans?.intervalMinutes], [true, dot.id, 120]);
  check("work only goes to villagers who can take it", (await power("assign_goal", { to: "Ann", title: "x" })).includes("Ann is paused"), true);
  check("…and who live here", (await power("assign_goal", { to: "Zed", title: "x" })).startsWith('Refused: nobody called "Zed"'), true);

  const review = await power("review_agent", { name: "Cal" });
  check("the Mayor can review a villager: spending, sessions and tool calls", [review.startsWith("Cal (Carpenter) — active"), review.includes("Spent today: $"), review.includes("- ask_villager [success"), review.includes("#" + bridge.id + " Fix the bridge")], [true, true, true, true]);

  check("he can't pause himself", (await power("pause_agent", { name: "Mayor Ada", reason: "tired" })).startsWith("Refused: you can't pause yourself"), true);
  check("…or the whole town", (await power("pause_agent", { name: "everyone", reason: "x" })).startsWith('Refused: nobody called "everyone"'), true);
  check("…and has to say why", (await power("pause_agent", { name: "Dot" })).includes("say why"), true);
  check("…and can't act on a neighbour's say-so while answering them", (await power("pause_agent", { name: "Dot", reason: "x" }, { ...ctxMayor, trigger: "message" })).includes("answering a neighbour"), true);
  await power("pause_agent", { name: "Dot", reason: "Spending too much on searches." });
  const dotNow = (await db.select().from(agents).where(eq(agents.id, dot.id)))[0];
  check("the Mayor can pause one villager", [dotNow.status, dotNow.pausedBy], ["paused", "mayor"]);
  const told = (await db.select().from(notifications).where(eq(notifications.title, "Mayor Ada paused Dot")))[0];
  check("…and the owner is told why", told?.body, "Spending too much on searches.");
  check("he can't let someone the owner paused work again", (await power("resume_agent", { name: "Ann" })).includes("only the owner can"), true);
  await power("resume_agent", { name: "Dot" });
  const dotBack = (await db.select().from(agents).where(eq(agents.id, dot.id)))[0];
  check("…but can let someone he paused work again", [dotBack.status, dotBack.pausedBy], ["active", null]);
  await power("pause_agent", { name: "Dot", reason: "again" });
  await agentRoute.PATCH(req(`/api/agents/${dot.id}`, "PATCH", { status: "active" }), { params: Promise.resolve({ id: String(dot.id) }) });
  check("the owner can always let them work again", (await db.select().from(agents).where(eq(agents.id, dot.id)))[0].pausedBy, null);

  for (let i = 0; i < FLAGS_PER_HOUR; i++) await power("flag", { title: `Problem ${i}` });
  check("the Mayor can flag problems to the owner", (await db.select().from(notifications).where(eq(notifications.kind, "flag"))).length, FLAGS_PER_HOUR);
  check("…a few an hour", (await power("flag", { title: "One more" })).includes(`flagged ${FLAGS_PER_HOUR} things`), true);

  // What stays with the owner has no tool at all, and the back doors are shut.
  check("no tool approves, changes settings, overrides, limits or the global pause, or dismisses", ALL_TOOL_DEFINITIONS.map((t) => t.function.name).filter((n) => /approv|setting|override|limit|budget|dismiss|global|unpause/i.test(n)), []);
  check("the Mayor can't change settings through the database", (await executeTool("query_database", { sql: "UPDATE agent_settings SET paused = 0" }, town, ctxMayor)).output, "Only read-only SELECT queries are allowed.");
  check("…or raise a budget", (await executeTool("query_database", { sql: "WITH x AS (SELECT 1) UPDATE agents SET daily_budget_usd = 99" }, town, ctxMayor)).output, "Only read-only SELECT queries are allowed.");
  check("…or approve his own requests", (await executeTool("query_database", { sql: "SELECT 1; UPDATE tool_executions SET status = 'approved'" }, town, ctxMayor)).output, "Only read-only SELECT queries are allowed.");

  // --- hiring: directors and workers (#99) ----------------------------------------------
  const { proposeHire } = await import("../src/lib/agent/hiring");
  const { hireRequests } = await import("../src/db/schema");
  const hiresRoute = await import("../src/app/api/hires/[id]/route");
  await updateSettings({ maxPopulation: 20, hiringMode: "ask" });
  const gus = (await add({ name: "Gus", role: "Head gardener", tier: "director", area: "garden", dailyBudgetUsd: 1, enabledTools: ["read_file", "list_directory", "update_journal", "manage_goal", "propose_hire"] })).agent;
  const wes = (await add({ name: "Wes", role: "Gardener", tier: "worker", managerId: gus.id, enabledTools: ["read_file", "propose_hire"] })).agent;
  const rowOf = async (id: number) => (await db.select().from(agents).where(eq(agents.id, id)))[0];
  const town2 = await getSettings();
  check("a director can draft hires; a worker never can", [villagers.effectiveTools(await rowOf(gus.id), town2).includes("propose_hire"), villagers.effectiveTools(await rowOf(wes.id), town2)], [true, ["read_file"]]);
  check("…and a director doesn't get the Mayor's tools", villagers.effectiveTools({ ...(await rowOf(gus.id)), enabledTools: ["pause_agent", "read_file"] }, town2), ["read_file"]);

  const ctxGus = { agentId: gus.id, agentName: "Gus", conversationId: null };
  const hal = { name: "Hal", role: "Weeder", persona: "Quiet and thorough.", dailyBudgetUsd: 0.5, reason: "The beds are full of weeds." };
  const ask = async (args: Record<string, unknown>, ctx: Record<string, unknown> = ctxGus) => (await proposeHire(args, ctx)).output;
  check("a worker can't take people on", (await ask(hal, { agentId: wes.id, agentName: "Wes" })).startsWith("Refused: workers can't"), true);
  check("only the Mayor takes on a director", (await ask({ ...hal, tier: "director" })).includes("only the Mayor"), true);
  check("a hire can't have tools the drafter hasn't got", (await ask({ ...hal, tools: ["read_file", "run_shell_command"] })).includes("can't have run_shell_command"), true);
  check("…nor a bigger budget than theirs", (await ask({ ...hal, dailyBudgetUsd: 5 })).includes("can't be more than yours ($1)"), true);
  check("…and needs a reason", (await ask({ ...hal, reason: "" })).includes("say why"), true);
  check("…and a name nobody has", (await ask({ ...hal, name: "cal" })).includes("someone called cal already lives here"), true);

  const waitHire = async (id: number) => {
    for (let i = 0; i < 50; i++) {
      const [r] = await db.select().from(hireRequests).where(eq(hireRequests.id, id));
      if (r.status !== "interviewing") return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    return null;
  };
  const requestId = (out: string) => Number(/#(\d+)/.exec(out)?.[1]);

  fake.byAgent["Mayor Ada"] = [{ text: "Gus needs the help, and Hal sounds steady.\nVERDICT: RECOMMEND" }];
  const halOut = await ask(hal);
  check("a director drafts a hire", halOut.startsWith("Drafted hire request #") && halOut.includes("then the owner decides"), true);
  const halReq = await waitHire(requestId(halOut));
  check("the Mayor interviews them and recommends; it waits for the owner", [halReq?.status, halReq?.verdict], ["awaiting_owner", "recommend"]);
  const interviewStep = fake.seen.filter((s) => s.system.startsWith("You are Mayor Ada") && s.system.includes("You're interviewing")).pop();
  check("the interview is talk only (no tools)", interviewStep?.tools, []);
  const interviewSession = (await db.select().from(workSessions).where(eq(workSessions.conversationId, halReq!.conversationId!)))[0];
  check("…a turn of the Mayor's, on his budget", [interviewSession?.agentId, interviewSession?.trigger], [mayor.id, "interview"]);
  check("the owner is told", (await db.select().from(notifications).where(eq(notifications.title, "Hire request: Hal"))).length, 1);
  check("a worker's draft gets the director's tools a worker may hold", (halReq!.draft as { enabledTools: string[] }).enabledTools, ["read_file", "list_directory", "update_journal", "manage_goal"]);

  const approve = (id: number, draft?: unknown) => hiresRoute.PATCH(req(`/api/hires/${id}`, "PATCH", { action: "approve", draft }), { params: Promise.resolve({ id: String(id) }) });
  const approved = await (await approve(halReq!.id, { persona: "Quiet, thorough, and fond of worms." })).json();
  const halRow = await rowOf(approved.agent?.id);
  check("the owner approves (and can edit first): Hal joins as Gus's worker", [halRow?.name, halRow?.tier, halRow?.managerId, halRow?.area, halRow?.persona, halRow?.home], ["Hal", "worker", gus.id, "garden", "Quiet, thorough, and fond of worms.", "villagers/hal"]);
  check("…and the request is closed", (await db.select().from(hireRequests).where(eq(hireRequests.id, halReq!.id)))[0].status, "hired");
  check("a decided request can't be approved again", (await approve(halReq!.id)).status, 409);

  fake.byAgent["Mayor Ada"] = [{ text: "We don't need two weeders.\nVERDICT: REJECT" }];
  const ivyReq = await waitHire(requestId(await ask({ ...hal, name: "Ivy" })));
  check("when the Mayor rejects, the request is declined", [ivyReq?.status, ivyReq?.decidedBy], ["declined", "mayor"]);
  check("…but the owner can still hire them", (await (await approve(ivyReq!.id)).json()).agent?.name, "Ivy");

  await updateSettings({ hiringMode: "auto" });
  fake.byAgent["Mayor Ada"] = [{ text: "Yes.\nVERDICT: RECOMMEND" }];
  const joReq = await waitHire(requestId(await ask({ ...hal, name: "Jo" })));
  check("with hiring set to automatic, the Mayor's recommendation hires them", [joReq?.status, joReq?.decidedBy], ["hired", "mayor"]);
  check("…and the owner is told", (await db.select().from(notifications).where(eq(notifications.title, "Jo joined the village"))).length, 1);
  fake.byAgent["Mayor Ada"] = [{ text: "Hmm, maybe." }];
  const kitReq = await waitHire(requestId(await ask({ ...hal, name: "Kit" })));
  check("…but an unclear verdict still waits for the owner", [kitReq?.status, kitReq?.verdict], ["awaiting_owner", "unsure"]);

  await updateSettings({ maxPopulation: villagers.population() });
  check("a full village takes nobody new", (await ask({ ...hal, name: "Lou" })).includes("the village is full"), true);
  const overCap = await approve(kitReq!.id);
  check("…not even when the owner approves (they raise the cap first)", [overCap.status, (await overCap.json()).error?.includes("the village is full")], [409, true]);
  const badMode = await settingsRoute.PUT(req("/api/settings", "PUT", { hiringMode: "yolo" }));
  check("hiring mode is ask or auto", badMode.status, 400);
  await updateSettings({ hiringMode: "ask", maxPopulation: 8 });

  // --- town meetings (#81) ----------------------------------------------------------------
  const meetingsRoute = await import("../src/app/api/meetings/route");
  const meetingRoute = await import("../src/app/api/meetings/[id]/route");
  const { meetings: meetingsT } = await import("../src/db/schema");
  const daytime = () => updateSettings({ bedtime: hm(new Date(Date.now() + 2 * 3600_000)), wakeTime: hm(new Date(Date.now() + 3 * 3600_000)) });
  await daytime();
  const view = async (id: number) => (await meetingRoute.GET(req(`/api/meetings/${id}`, "GET"), { params: Promise.resolve({ id: String(id) }) })).json();
  const patchMeeting = (id: number, body: unknown) => meetingRoute.PATCH(req(`/api/meetings/${id}`, "PATCH", body), { params: Promise.resolve({ id: String(id) }) });
  const roundDone = async (id: number) => {
    for (let i = 0; i < 100; i++) {
      const v = await view(id);
      if (!v.busy) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    return view(id);
  };
  fake.script.length = 0;
  for (const n of ["Mayor Ada", "Tom", "Bea", "Cal", "Dot", "Gus"]) fake.byAgent[n] = [{ text: `${n} thinks the bridge matters.` }, { text: `${n} again.` }];
  const called = await (await meetingsRoute.POST(req("/api/meetings", "POST", { topic: "The bridge" }))).json();
  const mid = called.meeting.id;
  const attendees = called.meeting.participants as number[];
  check("calling a meeting gathers every active villager, the Mayor first", [attendees[0], attendees.includes(ann.id), attendees.includes(gus.id)], [mayor.id, false, true]);
  check("…and they head for the town hall", villagers.villagerStates([gus.id, ann.id]).get(gus.id)?.inMeeting, true);
  check("calling again joins the same meeting", (await (await meetingsRoute.POST(req("/api/meetings", "POST", {}))).json()).meeting.id, mid);

  await patchMeeting(mid, { action: "ask", message: "Should we fix the bridge?" });
  const busyAsk = await patchMeeting(mid, { action: "ask", message: "Hello?" });
  check("one question at a time", busyAsk.status, 409);
  const after1 = await roundDone(mid);
  const lines1 = after1.transcript.map((t: { who: string; text: string }) => `${t.who}: ${t.text}`);
  check("everyone answers in turn (at most six), the Mayor first", lines1, [
    "You: Should we fix the bridge?",
    "Mayor Ada: Mayor Ada thinks the bridge matters.",
    "Tom: Tom thinks the bridge matters.",
    "Bea: Bea thinks the bridge matters.",
    "Cal: Cal thinks the bridge matters.",
    "Dot: Dot thinks the bridge matters.",
    "Gus: Gus thinks the bridge matters.",
  ]);
  const calMeetingStep = fake.seen.filter((x) => x.system.startsWith("You are Cal") && x.system.includes("town meeting")).pop();
  check("a meeting turn is talk only", calMeetingStep?.tools, []);
  const calThread = (await db.select().from(meetingsT).where(eq(meetingsT.id, mid)))[0].threads as Record<string, { conversationId: number }>;
  const calNotes1 = (await msgsOf(calThread[cal.id].conversationId)).filter((x) => x.role === "event");
  check("…hearing what was said before them", [calNotes1[0]?.content?.includes("The owner: Should we fix the bridge?"), calNotes1[0]?.content?.includes("Bea: Bea thinks")], [true, true]);
  check("the meeting's cost is counted", after1.cost > 0, true);

  await patchMeeting(mid, { action: "ask", message: "Who will do it?" });
  await roundDone(mid);
  const calNotes2 = (await msgsOf(calThread[cal.id].conversationId)).filter((x) => x.role === "event");
  check("next time they only hear what's new", [calNotes2[1]?.content?.includes("Who will do it?"), calNotes2[1]?.content?.includes("Should we fix the bridge?")], [true, false]);

  await updateSettings({ meetingCostCapUsd: 0.0000001 });
  await patchMeeting(mid, { action: "ask", message: "Anything else?" });
  const capped = await roundDone(mid);
  check("when the meeting's budget is spent, the round stops", capped.transcript[capped.transcript.length - 1].text.startsWith("The meeting has spent its budget"), true);
  await updateSettings({ meetingCostCapUsd: 0.25 });

  await patchMeeting(mid, { action: "close" });
  check("an ended meeting takes no more questions", (await patchMeeting(mid, { action: "ask", message: "Hello?" })).status, 409);
  check("…and everyone goes back to work", villagers.villagerStates([gus.id]).get(gus.id)?.inMeeting, false);
  await updateSettings({ bedtime: hm(new Date(Date.now() - 3600_000)), wakeTime: hm(new Date(Date.now() + 3600_000)) });
  check("no meetings at night", (await meetingsRoute.POST(req("/api/meetings", "POST", {}))).status, 409);
  await daytime();

  check("only the Mayor can call a meeting", (await executeTool("call_meeting", { topic: "x" }, town, ctxCal)).output, "Refused: only the Mayor can do that.");
  for (const n of ["Tom", "Bea", "Cal", "Dot", "Gus"]) fake.byAgent[n] = [{ text: `${n}: lanterns, yes.` }];
  const mayorCall = await power("call_meeting", { topic: "Should we hang lanterns on the bridge?" });
  check("the Mayor can call one", mayorCall.startsWith("Called town meeting #"), true);
  const opened = await roundDone(Number(/#(\d+)/.exec(mayorCall)?.[1]));
  check("…he opens it with the topic, and the others answer (not him)", [opened.transcript[0].who, opened.transcript[0].text, opened.transcript.some((t: { who: string }, i: number) => i > 0 && t.who === "Mayor Ada")], ["Mayor Ada", "Should we hang lanterns on the bridge?", false]);
  check("…and the owner is told", (await db.select().from(notifications).where(eq(notifications.title, "Mayor Ada called a town meeting"))).length, 1);
  check("there's only ever one meeting", (await power("call_meeting", { topic: "Again" })).includes("already a meeting"), true);
  await patchMeeting(opened.meeting.id, { action: "close" });
  await updateSettings({ bedtime: "22:00", wakeTime: "07:00" });

  // --- away mode (#102) ---------------------------------------------------------------------
  const away = await import("../src/lib/agent/away");
  await daytime();
  const pend = async (agentId: number, riskLevel: "low" | "medium" | "high", tool = "list_goals") =>
    (await db.insert(toolExecutions).values({ tool, input: {}, riskLevel, riskReason: "test", status: "awaiting_approval", agentId }).returning())[0].id;
  const statusOf = async (id: number) => (await db.select().from(toolExecutions).where(eq(toolExecutions.id, id)))[0];
  const quiet = await pend(cal.id, "low");
  check("while the owner is home, the Mayor leaves requests alone", await away.considerWhileAway(quiet), "skipped");
  const past = await settingsRoute.PUT(req("/api/settings", "PUT", { awayUntil: new Date(Date.now() - 60_000).toISOString() }));
  check("you can't be away until the past", [past.status, (await past.json()).error], [400, "awayUntil: must be in the future."]);
  await settingsRoute.PUT(req("/api/settings", "PUT", { awayUntil: new Date(Date.now() + 86400_000).toISOString(), awaySpendCapUsd: 5 }));
  check("going away starts the away count", (await getSettings()).awayStartedAt != null, true);

  fake.byAgent["Mayor Ada"] = [{ text: "Listing goals is harmless.\nDECISION: APPROVE" }];
  const seenBefore = fake.seen.length;
  check("away, the Mayor may approve a small request", await away.considerWhileAway(quiet), "approved");
  const approvedRow = await statusOf(quiet);
  check("…it runs, recorded as his decision", [approvedRow.status, approvedRow.resolvedBy], ["approved", "mayor-away"]);
  const reviewStep = fake.seen.slice(seenBefore).find((x) => x.system.startsWith("You are Mayor Ada"));
  check("…after a talk-only review", [reviewStep?.tools, reviewStep?.system.includes("The owner is away")], [[], true]);

  fake.byAgent["Mayor Ada"] = [{ text: "Not sure about this one.\nDECISION: LEAVE" }];
  const unsure = await pend(cal.id, "medium");
  check("what he isn't sure of waits for the owner", [await away.considerWhileAway(unsure), (await statusOf(unsure)).status], ["left", "awaiting_approval"]);
  const risky = await pend(cal.id, "high", "run_shell_command");
  const seenRisky = fake.seen.length;
  check("high-risk requests always wait for the owner (he isn't even asked)", [await away.considerWhileAway(risky), (await statusOf(risky)).status, fake.seen.length], ["skipped", "awaiting_approval", seenRisky]);
  check("never his own requests", await away.considerWhileAway(await pend(mayor.id, "low")), "skipped");
  await updateSettings({ awaySpendCapUsd: 0 });
  check("nothing once the away budget is spent", await away.considerWhileAway(await pend(cal.id, "low")), "skipped");
  await updateSettings({ awaySpendCapUsd: 5, bedtime: hm(new Date(Date.now() - 3600_000)), wakeTime: hm(new Date(Date.now() + 3600_000)) });
  check("nothing at night", await away.considerWhileAway(await pend(cal.id, "low")), "skipped");
  await daytime();

  // A real turn: in manual mode a medium-risk request waits, and the Mayor sees to it.
  await updateSettings({ autonomyMode: "manual" });
  fake.byAgent["Mayor Ada"] = [{ text: "Fine.\nDECISION: APPROVE" }];
  fake.byAgent.Cal = [{ tools: [{ name: "schedule_job", args: { name: "Sand the planks", intervalMinutes: 120 } }] }, { text: "Asked." }, { text: "Thanks, Mayor." }];
  const { conversationId: calAway } = await runAgentTurn({ userMessage: "what are your goals?", agentId: cal.id });
  let handled = null;
  for (let i = 0; i < 50 && !handled; i++) {
    const [row] = await db.select().from(toolExecutions).where(eq(toolExecutions.conversationId, calAway));
    if (row?.resolvedBy === "mayor-away") handled = row;
    else await new Promise((r) => setTimeout(r, 100));
  }
  check("a request made while away goes to the Mayor by itself", [handled?.tool, handled?.status, handled?.resolvedBy], ["schedule_job", "approved", "mayor-away"]);
  await updateSettings({ autonomyMode: "balanced" });
  const awayNow = await (await (await import("../src/app/api/away/route")).GET()).json();
  check("the owner sees what he approved", [awayNow.away, awayNow.decisions.length], [true, 2]);
  await settingsRoute.PUT(req("/api/settings", "PUT", { awayUntil: null }));
  check("once back, the Mayor stops", await away.considerWhileAway(await pend(cal.id, "low")), "skipped");
  await updateSettings({ bedtime: "22:00", wakeTime: "07:00" });

  // --- notes about neighbours (#103) and morale (#104) -------------------------------------
  const noteOut = (args: Record<string, unknown>) => executeTool("note_about", args, town, ctxCal).then((r) => r.output);
  check("a villager can note something about a neighbour", await noteOut({ villager: "dot", note: "Dot knew exactly where the nets were." }), "Noted in your diary, about Dot.");
  const [noteRow] = await db.select().from(journalEntries).where(eq(journalEntries.title, "About Dot"));
  check("…kept in their own diary, marked as about Dot", [noteRow?.agentId, noteRow?.subjectAgentId, noteRow?.category], [cal.id, dot.id, "neighbour"]);
  check("not about themselves", (await noteOut({ villager: "Cal", note: "x" })).includes("that's you"), true);
  check("not about strangers", (await noteOut({ villager: "Zed", note: "x" })).includes('nobody called "Zed"'), true);
  for (let i = 0; i < 7; i++) await noteOut({ villager: "Gus", note: `note ${i}` });
  check("a few a day at most", (await noteOut({ villager: "Gus", note: "one more" })).includes("8 notes about neighbours today"), true);
  check("diaries can't be read through the database", (await executeTool("query_database", { sql: "SELECT body FROM journal_entries" }, town, ctxCal)).output.startsWith("Diaries are private"), true);
  check("the Mayor's review sums up what neighbours say", (await power("review_agent", { name: "Dot" })).includes(`Neighbours' notes this week: 1. Latest: Cal: "Dot knew exactly`), true);

  const { moraleScore, villageMorale } = await import("../src/lib/agent/morale");
  check("morale adds up from the record, with reasons", moraleScore({ approved: 3, dropped: 1, daysSinceOwner: 5, notesReceived: 2, budgetSpent: false }), {
    score: 52,
    reasons: ["3 things done this week (+6)", "1 dropped or refused (−3)", "5 days since you talked (−15)", "2 notes from neighbours (+4)"],
  });
  check("…and stays between 0 and 100", [moraleScore({ approved: 0, dropped: 20, daysSinceOwner: 30, notesReceived: 0, budgetSpent: true }).score, moraleScore({ approved: 50, dropped: 0, daysSinceOwner: 0, notesReceived: 9, budgetSpent: false }).score], [0, 90]);
  const board = await villageMorale();
  check("every villager is on the morale board", board.length, (await villagers.listVillagers()).length);
  check("…and Gus's notes from Cal count for him", board.find((b) => b.name === "Gus")?.reasons.some((r) => r.startsWith("7 notes from neighbours")), true);

  // --- ideas and voting (#98), free time (#59) -------------------------------------------
  const ideasLib = await import("../src/lib/agent/ideas");
  const ideasRoute = await import("../src/app/api/ideas/route");
  const ideaRoute = await import("../src/app/api/ideas/[id]/route");
  const { ideas: ideasT } = await import("../src/db/schema");
  await daytime();
  check("quorum and majority", [
    ideasLib.tally(["yes", "yes", "no"], 5).outcome,
    ideasLib.tally(["yes"], 5).outcome,
    ideasLib.tally(["yes", "no", "abstain"], 5).outcome,
    ideasLib.tally(["no", "no", "yes"], 5).outcome,
  ], ["adopted", "open", "open", "rejected"]);
  const pin = (args: Record<string, unknown>) => executeTool("propose_idea", args, town, ctxCal).then((r) => r.output);
  const pinned = await pin({ title: "A rope bridge over the stream", body: "Shorter walk to the fields." });
  check("a villager can pin an idea", pinned.startsWith("Pinned idea #"), true);
  await pin({ title: "Idea two" });
  await pin({ title: "Idea three" });
  check("a few a day at most", (await pin({ title: "Idea four" })).includes("3 ideas today"), true);
  const ownerIdea = (await (await ideasRoute.POST(req("/api/ideas", "POST", { title: "Paint the town hall" }))).json()).idea;
  check("the owner can pin one too", [ownerIdea.title, ownerIdea.proposedBy], ["Paint the town hall", null]);

  const voters = await db.select().from(agents).where(eq(agents.status, "active"));
  const castAll = (choice: (i: number) => string) => voters.forEach((v, i) => (fake.byAgent[v.name] = [{ text: `My reason ${i}.\nVOTE: ${choice(i)}` }]));
  const settleIdea = async (id: number) => {
    for (let i = 0; i < 100; i++) {
      const row = (await ideasLib.listIdeas()).find((x) => x.id === id)!;
      if (!row.voting) return row;
      await new Promise((r) => setTimeout(r, 100));
    }
    return (await ideasLib.listIdeas()).find((x) => x.id === id)!;
  };
  const bridgeId = Number(/#(\d+)/.exec(pinned)?.[1]);
  castAll((i) => (i % 3 === 2 ? "NO" : "YES"));
  const ideaPatch = (id: number, action: string) => ideaRoute.PATCH(req(`/api/ideas/${id}`, "PATCH", { action }), { params: Promise.resolve({ id: String(id) }) });
  await ideaPatch(bridgeId, "vote");
  const ropeIdea = await settleIdea(bridgeId);
  check("everyone active votes, with a reason", [ropeIdea.votes.length, ropeIdea.votes.every((v) => v.reason?.startsWith("My reason"))], [voters.length, true]);
  check("a majority with quorum adopts it as a town goal", [ropeIdea.status, ropeIdea.decidedBy, ropeIdea.goalId != null], ["adopted", "vote", true]);
  const bridgeGoal = (await db.select().from(goals).where(eq(goals.id, ropeIdea.goalId!)))[0];
  check("…the goal belongs to the town", [bridgeGoal.agentId, bridgeGoal.title], [null, "A rope bridge over the stream"]);
  check("…and the owner is told", (await db.select().from(notifications).where(eq(notifications.title, "Adopted: A rope bridge over the stream"))).length, 1);
  const voteStep = fake.seen.filter((x) => x.system.includes("The village is voting")).pop();
  check("a vote is talk only", voteStep?.tools, []);
  await ideaPatch(bridgeId, "veto");
  check("the owner can veto, even after adoption, and its goal comes down", [(await settleIdea(bridgeId)).status, (await db.select().from(goals).where(eq(goals.id, ropeIdea.goalId!)))[0].status], ["vetoed", "abandoned"]);

  const twoId = (await db.select().from(ideasT).where(eq(ideasT.title, "Idea two")))[0].id;
  castAll((i) => (i % 3 === 2 ? "YES" : "NO"));
  await ideaPatch(twoId, "vote");
  check("more no than yes turns it down", (await settleIdea(twoId)).status, "rejected");

  const threeId = (await db.select().from(ideasT).where(eq(ideasT.title, "Idea three")))[0].id;
  await updateSettings({ voteCostCapUsd: 0.0000001 });
  castAll(() => "YES");
  await ideaPatch(threeId, "vote");
  const short = await settleIdea(threeId);
  check("when the round's budget runs out, no quorum: it stays open", [short.status, short.votes.length], ["open", 1]);
  await updateSettings({ voteCostCapUsd: 0.15 });
  check("the owner can adopt an idea straight away", [(await ideaPatch(ownerIdea.id, "adopt")).status, (await settleIdea(ownerIdea.id)).decidedBy], [200, "owner"]);
  check("only the Mayor can call a vote", (await executeTool("call_vote", { ideaId: threeId }, town, ctxCal)).output, "Refused: only the Mayor can do that.");
  castAll(() => "YES");
  check("the Mayor can", (await power("call_vote", { ideaId: threeId })).startsWith(`The vote on idea #${threeId}`), true);
  check("…and it's adopted", (await settleIdea(threeId)).status, "adopted");
  check("one daily vote at most", await ideasLib.dailyVote(), null);
  await updateSettings({ bedtime: hm(new Date(Date.now() - 3600_000)), wakeTime: hm(new Date(Date.now() + 3600_000)) });
  const nightIdea = (await (await ideasRoute.POST(req("/api/ideas", "POST", { title: "Night idea" }))).json()).idea;
  check("no votes at night", (await ideaPatch(nightIdea.id, "vote")).status, 409);
  await updateSettings({ bedtime: "22:00", wakeTime: "07:00" });

  await agentRoute.PATCH(req(`/api/agents/${dot.id}`, "PATCH", { daydream: true }), { params: Promise.resolve({ id: String(dot.id) }) });
  const dream = (await db.select().from(jobs).where(eq(jobs.agentId, dot.id))).find((j) => j.kind === "daydream");
  check("free time is a short window of their own every few hours", [dream?.enabled, dream?.intervalMinutes, dream?.maxDurationMinutes], [true, 240, 5]);
  check("…shown on the Villagers page", villagers.villagerStates([dot.id]).get(dot.id)?.daydream, true);
  await agentRoute.PATCH(req(`/api/agents/${dot.id}`, "PATCH", { daydream: false }), { params: Promise.resolve({ id: String(dot.id) }) });
  check("…and can be switched off", villagers.villagerStates([dot.id]).get(dot.id)?.daydream, false);

  // --- the village grows (#105) and its farm and bakery (#106) ------------------------------
  const bld = await import("../src/lib/agent/buildings");
  const econ = await import("../src/lib/agent/economy");
  const buildingsRoute = await import("../src/app/api/buildings/route");
  const buildingRoute = await import("../src/app/api/buildings/[id]/route");
  const patchBuilding = (id: number, body: unknown) => buildingRoute.PATCH(req(`/api/buildings/${id}`, "PATCH", body), { params: Promise.resolve({ id: String(id) }) });
  const cap0 = bld.populationCap(await getSettings());
  check("only the Mayor proposes buildings", (await executeTool("propose_building", { kind: "house", reason: "x" }, town, ctxCal)).output, "Refused: only the Mayor can do that.");
  const proposed = await power("propose_building", { kind: "house", plot: "north-1", reason: "We're running out of beds." });
  check("the Mayor proposes a house on a plot", proposed.startsWith("Proposed a house on the north-1 plot"), true);
  check("…and the owner is told", (await db.select().from(notifications).where(eq(notifications.title, "The Mayor would like to build a house"))).length, 1);
  check("a plot can't take two", (await power("propose_building", { kind: "farm", plot: "north-1", reason: "x" })).includes("north-1 plot is taken"), true);
  check("there are only four plots", (await power("propose_building", { kind: "farm", plot: "south-9", reason: "x" })).includes('no plot called "south-9"'), true);
  const houseId = Number(/#(\d+)/.exec(proposed)?.[1]);
  check("nothing is built until the owner says so", (await bld.listBuildings()).find((b) => b.id === houseId)?.status, "proposed");
  await patchBuilding(houseId, { action: "approve" });
  check("approved, it's scaffolding for half a day", (await bld.listBuildings()).find((b) => b.id === houseId)?.status, "building");
  const later = new Date(Date.now() + 13 * 3600_000);
  check("…then it stands", (await bld.listBuildings(later)).find((b) => b.id === houseId)?.status, "built");
  check("a house makes room for two more villagers", bld.populationCap(await getSettings()), cap0 + 2);

  const farm = (await (await buildingsRoute.POST(req("/api/buildings", "POST", { kind: "farm", plotId: "west-1" }))).json()).building;
  const bakery = (await (await buildingsRoute.POST(req("/api/buildings", "POST", { kind: "bakery", plotId: "west-2" }))).json()).building;
  check("the owner builds straight away", [farm.status, bakery.status], ["building", "building"]);
  const declined = await power("propose_building", { kind: "workshop", reason: "x" });
  await patchBuilding(Number(/#(\d+)/.exec(declined)?.[1]), { action: "decline" });
  check("…and can turn the Mayor down", (await bld.listBuildings()).some((b) => b.kind === "workshop"), false);
  await patchBuilding(farm.id, { action: "keeper", agentId: gus.id });

  check("a day's bookkeeping: grow, bake, eat", econ.economyTick({ wheat: 0, bread: 6 }, [true, false], [true], 5), { wheat: 2, bread: 7, shortage: 0, grown: 8, baked: 6 });
  check("…running short", econ.economyTick({ wheat: 0, bread: 1 }, [], [], 4).shortage, 3);
  const stockBefore = await econ.getEconomy();
  check("the day's economy runs once a day", [await econ.dailyEconomy(later), await econ.dailyEconomy(later)], [true, false]);
  const after = await econ.getEconomy();
  check("…the kept farm grew 6 wheat, the unkept bakery baked 2", [after.wheat, after.bread], [stockBefore.wheat + 6 - 2, Math.max(0, stockBefore.bread + 2 - (await db.select().from(agents).where(eq(agents.status, "active"))).length)]);
  check("keepers spend their spare time at their building", (await econ.keeperDoors())[gus.id], "west-1");
  check("when the village runs short, morale dips", (await (await import("../src/lib/agent/morale")).villageMorale()).every((m) => m.reasons.includes("the village ran short of bread (−10)")), after.shortage > 0);

  // --- the outbox (#107) and the owner's calendar (#108) ---------------------------------
  const { drafts: draftsT } = await import("../src/db/schema");
  const draftRoute = await import("../src/app/api/drafts/[id]/route");
  const drafted = await executeTool("save_draft", { kind: "email", to: "shop@example.com", subject: "Order", content: "Two sacks of flour, please." }, town, ctxCal);
  check("a villager saves outward work as a draft", drafted.output.startsWith("Saved draft #") && drafted.output.includes("Nothing has been sent"), true);
  const draftId = Number(/#(\d+)/.exec(drafted.output)?.[1]);
  const draftRow = async () => (await db.select().from(draftsT).where(eq(draftsT.id, draftId)))[0];
  check("…it waits for the owner", [(await draftRow()).status, (await draftRow()).agentId], ["draft", cal.id]);
  const decideD = (id: number, body: unknown) => draftRoute.PATCH(req(`/api/drafts/${id}`, "PATCH", body), { params: Promise.resolve({ id: String(id) }) });
  await decideD(draftId, { action: "approve", edits: { content: "Three sacks of flour, please." } });
  check("the owner approves it, with their edits (no connector yet: ready to send by hand)", [(await draftRow()).status, (await draftRow()).content], ["approved", "Three sacks of flour, please."]);
  check("a decided draft stays decided", (await decideD(draftId, { action: "discard" })).status, 409);
  const second = Number(/#(\d+)/.exec((await executeTool("save_draft", { kind: "post", content: "Hello world" }, town, ctxCal)).output)?.[1]);
  await decideD(second, { action: "discard" });
  check("…or discards it", (await db.select().from(draftsT).where(eq(draftsT.id, second)))[0].status, "discarded");
  check("no tool sends or approves anything", ALL_TOOL_DEFINITIONS.map((t) => t.function.name).filter((n) => /send|publish|approve_draft/i.test(n)), []);

  const cal2 = await import("../src/lib/agent/calendar");
  const now0 = new Date(2026, 9, 26, 8, 0, 0); // a Monday morning
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART:20261026T090000",
    "DTEND:20261026T093000",
    "SUMMARY:Stand-up with a long",
    "  folded title",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261030",
    "SUMMARY:Guitar lesson",
    "LOCATION:Music shop\\, high street",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART:20261027T120000Z",
    "SUMMARY:Cancelled lunch",
    "STATUS:CANCELLED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const evs = cal2.parseIcs(ics, now0, new Date(2026, 10, 9));
  check("an ICS calendar is read: folded lines, weekly repeats, all-day events, cancellations", evs.map((e) => [e.summary, e.start.getDate(), e.allDay]), [
    ["Stand-up with a long folded title", 26, false],
    ["Stand-up with a long folded title", 28, false],
    ["Guitar lesson", 30, true],
    ["Stand-up with a long folded title", 2, false],
    ["Stand-up with a long folded title", 4, false],
  ]);
  check("…with places", evs.find((e) => e.summary === "Guitar lesson")?.location, "Music shop, high street");
  const http = await import("node:http");
  const icsServer = http.createServer((_q, r) => r.end(ics));
  await new Promise<void>((r) => icsServer.listen(0, "127.0.0.1", () => r()));
  const icsUrl = `http://127.0.0.1:${(icsServer.address() as { port: number }).port}/my.ics`;
  check("only web calendar addresses", (await settingsRoute.PUT(req("/api/settings", "PUT", { calendarIcsUrl: "file:///etc/passwd" }))).status, 400);
  await settingsRoute.PUT(req("/api/settings", "PUT", { calendarIcsUrl: icsUrl }));
  const shownSettings = (await (await settingsRoute.GET()).json()).settings;
  check("the address is a secret: the page only learns it's set", [shownSettings.calendarSet, "calendarIcsUrl" in shownSettings], [true, false]);
  check("…and no villager can read it from the database", (await executeTool("query_database", { sql: "SELECT calendar_ics_url FROM agent_settings" }, town, ctxMayor)).output, "Queries that mention the calendar address are not allowed.");
  const upcoming = await cal2.upcomingEvents(400, new Date(2026, 9, 25));
  check("the owner's calendar is fetched and shown", [upcoming.configured, upcoming.error, upcoming.events.length > 0], [true, undefined, true]);
  icsServer.close();
  await settingsRoute.PUT(req("/api/settings", "PUT", { calendarIcsUrl: null }));

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
