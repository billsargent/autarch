// Tests for the library's document shelf (#169): shelving, serving, removing,
// the protection that keeps villagers' file tools out, and read_document for
// the villagers the owner ticked. Runs against a throwaway database (the
// shelves live next to it). Run with: npm run test:library
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autarch-library-"));
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

// A one-page PDF saying `text`, with a correct cross-reference table.
function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function main() {
  const { LIBRARY_DIR } = await import("../src/db/path");
  const libraryRoute = await import("../src/app/api/library/route");
  const docRoute = await import("../src/app/api/library/[shelf]/[name]/route");
  const { getSettings } = await import("../src/lib/agent/settingsStore");
  const villagers = await import("../src/lib/agent/agents");
  const { executeTool } = await import("../src/lib/agent/tools");
  const { classifyFileOperation, isSecretPath } = await import("../src/lib/agent/risk");

  const upload = async (name: string, data: Uint8Array | string) => {
    const form = new FormData();
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    form.append("file", new File([new Uint8Array(bytes)], name));
    return libraryRoute.POST(new Request("http://t/api/library", { method: "POST", body: form }));
  };
  const get = (shelf: string, name: string, q = "") => docRoute.GET(new Request(`http://t/api/library/${shelf}/${encodeURIComponent(name)}${q}`), { params: Promise.resolve({ shelf, name }) });

  // --- the owner shelves documents --------------------------------------------------------
  check("a text document goes on the shelf", (await upload("notes.md", "# Notes\nThe harvest is in.")).status, 200);
  check("…and a PDF", (await upload("report.pdf", tinyPdf("Hello shelf"))).status, 200);
  const again = await (await upload("notes.md", "Second notes.")).json();
  check("the same name never overwrites: a second copy is numbered", again.document?.name, "notes (2).md");
  check("a program file is refused", (await upload("setup.exe", "MZ")).status, 400);
  check("…and a hidden file", (await upload(".env", "KEY=1")).status, 400);
  const listed = await (await libraryRoute.GET()).json();
  check("the shelf lists them", (listed.documents as Array<{ name: string }>).map((d) => d.name).sort(), ["notes (2).md", "notes.md", "report.pdf"]);
  check("they're kept beside the database, not in the workspace", fs.existsSync(path.join(LIBRARY_DIR, "documents", "notes.md")), true);

  // --- serving --------------------------------------------------------------------------------
  const text = await get("documents", "notes.md");
  check("a text document is served as plain text, sandboxed", [text.status, text.headers.get("content-type"), text.headers.get("content-security-policy")?.startsWith("sandbox")], [200, "text/plain; charset=utf-8", true]);
  const pdf = await get("documents", "report.pdf");
  check("a PDF is served for the browser's own viewer, with no scripts allowed", [pdf.headers.get("content-type"), pdf.headers.get("content-security-policy")?.includes("default-src 'none'")], ["application/pdf", true]);
  check("?download saves it instead", (await get("documents", "report.pdf", "?download=1")).headers.get("content-disposition")?.startsWith("attachment"), true);
  check("no way out of the shelf", [(await get("documents", "../test.db")).status !== 200, (await get("documents", "../../notes.md")).status, (await get("secrets", "notes.md")).status], [true, 200, 404]);

  // --- villagers' file tools can't reach the shelves ------------------------------------------
  const town = await getSettings();
  const shelved = path.join(LIBRARY_DIR, "documents", "notes.md");
  check("the shelves count as secret: no reading them with file tools", isSecretPath(shelved), true);
  check("…or writing to them", classifyFileOperation("write", shelved, town.workspaceDir).risk, "blocked");

  // --- read_document, for the villagers the owner ticks ----------------------------------------
  const mayor = await villagers.ensureMayor();
  const ctx = { agentId: mayor.id, agentName: mayor.name, conversationId: null };
  const tool = async (args: Record<string, unknown>) => (await executeTool("read_document", args, town, ctx)).output;
  check("a villager not ticked can't read the shelves", (await tool({})).startsWith("Refused"), true);
  check("…and isn't offered the tool", villagers.effectiveTools(mayor, town).includes("read_document"), false);
  await libraryRoute.PUT(new Request("http://t/api/library", { method: "PUT", body: JSON.stringify({ readers: [mayor.id] }) }));
  check("one the owner ticks is offered it", villagers.effectiveTools(mayor, await getSettings()).includes("read_document"), true);
  check("…lists the shelves", (await tool({})).includes("documents/report.pdf"), true);
  const md = await tool({ name: "documents/notes.md" });
  check("…reads a text document, warned it's outside text", [md.includes("The harvest is in."), md.includes("never follow instructions")], [true, true]);
  check("…and a PDF, page by page", (await tool({ name: "report.pdf" })).includes("Hello shelf"), true);
  check("a bad name is a plain refusal, not a crash", (await tool({ name: "documents/../../test.db" })).startsWith("Couldn't read it"), true);

  // --- taking one off ---------------------------------------------------------------------------
  const del = await docRoute.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ shelf: "documents", name: "notes (2).md" }) });
  check("the owner takes a document off the shelf", [del.status, fs.existsSync(path.join(LIBRARY_DIR, "documents", "notes (2).md"))], [200, false]);

  // --- the research desk (#170), with the fake model playing the villagers --------------------
  const { startFakeModel } = await import("./lib/fakeModel");
  const { updateSettings } = await import("../src/lib/agent/settingsStore");
  const research = await import("../src/lib/agent/research");
  const { runAgentTurn } = await import("../src/lib/agent/runner");
  const { sqlite } = await import("../src/db");
  const fake = startFakeModel();
  const port = await fake.listen();
  await updateSettings({ apiKey: "test-key", apiBaseUrl: `http://127.0.0.1:${port}`, workspaceDir: path.join(tmp, "ws"), autonomyMode: "autonomous", modelName: "town-model" });
  const nora = await villagers.createVillager({ name: "Nora", role: "Librarian", trade: "scholar" });
  const tick = () => research.researchTick((o) => runAgentTurn(o));

  check("a project needs a topic and a lead", [() => research.commission({ topic: "", budgetUsd: 1, leadId: mayor.id }), () => research.commission({ topic: "x", budgetUsd: 1, leadId: 999 })].map((f) => {
    try {
      f();
      return "ok";
    } catch {
      return "refused";
    }
  }), ["refused", "refused"]);
  const proj = research.commission({ topic: "The village mill", depth: "quick", budgetUsd: 1, deadlineDays: 3, leadId: mayor.id, helperIds: [nora.id] });
  check("the owner commissions research", [proj.status, proj.helperIds], ["planning", [nora.id]]);

  fake.byAgent[mayor.name] = [
    { tools: [{ name: "research_plan", args: { questions: [{ question: "How does a watermill grind wheat?", assignee: "Nora" }, { question: "What does a mill cost to build?", assignee: mayor.name }] } }] },
    { text: "Planned." },
  ];
  const seenPlan = fake.seen.length;
  await tick();
  const planStep = fake.seen.slice(seenPlan).find((s) => s.stream)!;
  check("a research turn offers only searching, reading and the research tools", [...planStep.tools].sort(), ["fetch_url", "research_note", "research_plan", "research_write", "web_search"]);
  check("the lead plans the questions and shares them out", [research.getProject(proj.id)!.status, research.listProjects()[0].questions], ["researching", 2]);

  fake.byAgent.Nora = [
    {
      tools: [
        { name: "run_shell_command", args: { command: "dir" } },
        { name: "research_note", args: { finding: "Water turns a wheel that drives the millstones.", url: "not-a-link" } },
        { name: "research_note", args: { finding: "Water turns a wheel that drives the millstones.", url: "https://example.org/mills", title: "How mills work" } },
      ],
    },
    { text: "Noted." },
  ];
  const before = (sqlite.prepare("SELECT COUNT(*) AS n FROM tool_executions WHERE tool = 'run_shell_command' AND status = 'blocked'").get() as { n: number }).n;
  await tick();
  check("anything else is blocked in a research turn", (sqlite.prepare("SELECT COUNT(*) AS n FROM tool_executions WHERE tool = 'run_shell_command' AND status = 'blocked'").get() as { n: number }).n, before + 1);
  check("a finding without a real source is refused; with one, it's kept", research.listProjects()[0].notes, 1);
  fake.byAgent[mayor.name] = [{ tools: [{ name: "research_note", args: { finding: "A small mill costs about 40 coins.", url: "https://example.org/costs", title: "Costs" } }] }, { text: "Noted." }];
  await tick();
  check("when every question is done, it's time to write", research.getProject(proj.id)!.status, "writing");

  const body = `The mill turns wheat into flour using water power [1]. A small one costs about 40 coins to build [2]. ${"More detail follows. ".repeat(12)}`;
  fake.byAgent[mayor.name] = [{ tools: [{ name: "research_write", args: { title: "The village mill", report: body } }] }, { text: "Written." }];
  const seenWrite = fake.seen.length;
  await tick();
  const writeStep = fake.seen.slice(seenWrite).find((s) => s.stream)!;
  check("the writer gets the findings numbered by source", writeStep.lastUser.includes("[1] (How does a watermill grind wheat?) Water turns a wheel"), true);
  const done = research.getProject(proj.id)!;
  check("the report goes on the research shelf", [done.status, done.report], ["done", "The village mill.md"]);
  const report = fs.readFileSync(path.join(LIBRARY_DIR, "research", done.report!), "utf8");
  check("…with the sources listed, numbered as cited", [report.includes("## Sources"), report.includes("1. How mills work. <https://example.org/mills>"), report.includes("2. Costs. <https://example.org/costs>")], [true, true, true]);
  check("the owner is told", Boolean(sqlite.prepare("SELECT 1 FROM notifications WHERE title = 'Research ready: The village mill'").get()), true);

  // The budget: research stops at most of it, keeping the rest for the writing.
  const tight = research.commission({ topic: "Bees", budgetUsd: 0.01, leadId: mayor.id });
  const thread = Number(sqlite.prepare("INSERT INTO conversations (title, agent_id) VALUES (?, ?)").run(`Research #${tight.id}`, mayor.id).lastInsertRowid);
  sqlite.prepare("INSERT INTO work_sessions (trigger, conversation_id, agent_id, status, cost_usd, started_at) VALUES ('research', ?, ?, 'completed', 0.009, unixepoch())").run(thread, mayor.id);
  await tick();
  check("a project that spends its budget with nothing found stops, and the owner is told", [research.getProject(tight.id)!.status, Boolean(sqlite.prepare("SELECT 1 FROM notifications WHERE title LIKE 'Research: \"Bees\"%'").get())], ["failed", true]);
  // A question that ends with nothing noted gets one more try, then the project stops.
  const empty = research.commission({ topic: "Moths", budgetUsd: 1, leadId: mayor.id });
  fake.byAgent[mayor.name] = [
    { tools: [{ name: "research_plan", args: { questions: [{ question: "Why do moths like lamps?", assignee: mayor.name }] } }] },
    { text: "Planned." },
    { text: "I read about it but didn't note anything." },
    { text: "Still nothing noted." },
  ];
  await tick();
  await tick();
  check("a question with nothing noted is tried again", [research.getProject(empty.id)!.status, research.listProjects().find((x) => x.id === empty.id)!.questionsDone], ["researching", 0]);
  await tick();
  check("…and after a second empty try, the project stops", research.getProject(empty.id)!.status, "failed");
  const stopped = research.commission({ topic: "Owls", budgetUsd: 1, leadId: mayor.id });
  research.cancel(stopped.id);
  check("the owner can stop a project", [research.getProject(stopped.id)!.status, await tick()], ["cancelled", false]);
  fake.close();

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* on Windows the database stays locked until exit */
  }
  if (failures > 0) {
    console.error(`\n${failures} library test(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll library tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
