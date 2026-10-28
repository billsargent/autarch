// Tests for the library's document shelf (#169): shelving, serving, removing,
// the protection that keeps villagers' file tools out, and read_document for
// the villagers the owner ticked. Runs against a throwaway database (the
// shelves live next to it). Run with: npm run test:library
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

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

  // --- report formats, the deep dive and the wider search ------------------------------------
  const formats = await import("../src/lib/agent/reportFormats");
  const mdSrc = "# Mills\n\nWater **turns** the *wheel* [1], see [the guide](https://example.org/g) and <https://example.org/x>.\n\n## Parts\n\n- The wheel\n- The stones\n\n1. First\n2. Second\n\n> A quote\n\n| Part | Cost |\n|---|---|\n| Wheel | 10 |\n\n```\ncode <b>\n```\n\nEnd & done.";
  const blocks = formats.parseMarkdown(mdSrc);
  check("the report reader finds headings, paragraphs, lists, quotes, tables and code", blocks.map((b) => b.kind), ["heading", "para", "heading", "item", "item", "item", "item", "quote", "table", "code", "para"]);
  check("…and bold, italics and links inside a line", (blocks[1] as unknown as { runs: Array<Record<string, unknown>> }).runs.filter((r) => r.bold || r.italic || r.link).map((r) => [r.text, Boolean(r.bold), Boolean(r.italic), r.link ?? null]), [
    ["turns", true, false, null],
    ["wheel", false, true, null],
    ["the guide", false, false, "https://example.org/g"],
    ["https://example.org/x", false, false, "https://example.org/x"],
  ]);
  const html = formats.toHtml(mdSrc + "\n\n[bad](javascript:alert(1)) <script>x</script>", "Mills & more");
  check("a web page report: a whole page, its text escaped", [html.startsWith("<!doctype html>"), html.includes("<title>Mills &amp; more</title>"), html.includes("<script>"), html.includes('href="javascript'), html.includes("<ol>"), html.includes("<th><strong>Part</strong></th>")], [true, true, false, false, true, true]);
  const txt = formats.toText(mdSrc);
  check("a plain text report keeps the links' addresses", [txt.startsWith("Mills\n====="), txt.includes("the guide (https://example.org/g)"), txt.includes("**")], [true, true, false]);
  const docx = formats.toDocx(mdSrc, "Mills");
  const unzip = (buf: Buffer) => {
    const files = new Map<string, string>();
    for (let at = 0; buf.readUInt32LE(at) === 0x04034b50; ) {
      const size = buf.readUInt32LE(at + 18);
      const nameLen = buf.readUInt16LE(at + 26);
      const name = buf.subarray(at + 30, at + 30 + nameLen).toString();
      files.set(name, zlib.inflateRawSync(buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size)).toString());
      at += 30 + nameLen + size;
    }
    return files;
  };
  const parts = unzip(docx);
  check("a Word report is a proper .docx", [...parts.keys()].sort(), ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"]);
  check("…with its headings, text and working links", [parts.get("word/document.xml")!.includes('<w:pStyle w:val="Title"/>'), parts.get("word/document.xml")!.includes("The stones"), parts.get("word/_rels/document.xml.rels")!.includes('Target="https://example.org/g" TargetMode="External"')], [true, true, true]);
  const pdfBuf = await formats.toPdf(mdSrc + "\n\nNon-Latin: 水车", "Mills");
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdfText = (await extractText(await getDocumentProxy(new Uint8Array(pdfBuf)), { mergePages: true })).text;
  check("a PDF report reads back as text", [pdfBuf.subarray(0, 5).toString(), pdfText.includes("Mills"), pdfText.includes("The stones"), pdfText.includes("Wheel")], ["%PDF-", true, true, true]);
  check("a PDF keeps accented letters it can't print as their plain letter", formats.pdfSafe("Śāh Łódź café 水"), "Sah Lódz café ?");
  check("an unknown format is refused", (() => {
    try {
      research.commission({ topic: "x", budgetUsd: 1, leadId: mayor.id, format: "exe" });
      return "";
    } catch (err) {
      return (err as Error).message;
    }
  })().startsWith("The report comes as"), true);

  // A deep dive: wide reading, more steps, a review round, and a Word report.
  const deep = research.commission({ topic: "Windmills", depth: "deep", format: "docx", budgetUsd: 2, leadId: mayor.id, helperIds: [nora.id] });
  const steps: Array<number | undefined> = [];
  const deepTick = () => research.researchTick((o) => (steps.push(o.maxSteps), runAgentTurn(o)));
  fake.byAgent[mayor.name] = [{ tools: [{ name: "research_plan", args: { questions: [{ question: "How do windmills turn?", assignee: "Nora" }] } }] }, { text: "Planned." }];
  await deepTick();
  fake.byAgent.Nora = [{ tools: [{ name: "research_note", args: { finding: "Sails catch the wind.", url: "https://example.org/sails", title: "Sails" } }] }, { text: "Done." }];
  await deepTick();
  const researchNote = String(fake.seen.filter((s) => s.system.startsWith("You are Nora")).at(-1)!.lastUser);
  check("a deep dive's researchers get more steps and are told to read widely", [steps[1], researchNote.includes("cast a wide net"), researchNote.includes("links: true")], [research.DEPTHS.deep.steps, true, true]);
  check("after the first round, the lead looks for gaps", research.getProject(deep.id)!.status, "reviewing");
  fake.byAgent[mayor.name] = [{ tools: [{ name: "research_plan", args: { questions: [{ question: "Who built the first one?", assignee: "Nora" }] } }] }, { text: "One gap." }];
  await deepTick();
  check("…and adds follow-ups, keeping the first questions", [research.getProject(deep.id)!.status, research.listProjects().find((x) => x.id === deep.id)!.questions], ["researching", 2]);
  fake.byAgent.Nora = [{ tools: [{ name: "research_note", args: { finding: "Persian windmills came first.", url: "https://example.org/persia", title: "History" } }] }, { text: "Done." }];
  await deepTick();
  check("the review happens once: then it's time to write", research.getProject(deep.id)!.status, "writing");
  fake.byAgent[mayor.name] = [
    { tools: [{ name: "research_write", args: { title: "Windmills", report: `## How they turn\n\n${"Sails catch the wind [1]. ".repeat(12)}`, more: true } }] },
    { tools: [{ name: "research_write", args: { report: "## History\n\nPersian windmills came first [2]." } }] },
    { text: "Written." },
  ];
  await deepTick();
  const deepDone = research.getProject(deep.id)!;
  check("a report written in parts is shelved whole, in the chosen format", [deepDone.status, deepDone.report], ["done", "Windmills.docx"]);
  check("…the lead having been told a long report can go in parts", String(fake.seen.filter((s) => s.system.startsWith(`You are ${mayor.name}`)).at(-1)!.lastUser).includes("send it in parts"), true);
  check("…its research turns had room for a long reply", fake.seen.filter((s) => s.system.startsWith(`You are ${mayor.name}`)).at(-1)!.maxTokens, research.RESEARCH_OUTPUT_TOKENS);
  const shelvedDocx = unzip(fs.readFileSync(path.join(LIBRARY_DIR, "research", deepDone.report!)));
  check("…with its title, both parts and its sources", ["Windmills", "Sails catch the wind", "Persian windmills came first", "https://example.org/persia"].map((s) => shelvedDocx.get("word/document.xml")!.includes(s) || shelvedDocx.get("word/_rels/document.xml.rels")!.includes(s)), [true, true, true, true]);
  check("a report's file name keeps hyphens and stops at a word", [research.fileTitle("How horizontal-axis windmills were developed in medieval Europe, 1100–1400"), research.fileTitle("Bees: why?")], ["How horizontal-axis windmills were developed in medieval", "Bees why"]);

  // The wider search: the owner's SearXNG first when set; DuckDuckGo's plain page and links on a page.
  const http = await import("node:http");
  const searx = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ results: [{ title: "Mill history", url: "https://example.org/mill", content: `asked: ${new URL(req.url!, "http://x").searchParams.get("q")}` }] }));
  });
  await new Promise<void>((r) => searx.listen(0, "127.0.0.1", r));
  const searxPort = (searx.address() as { port: number }).port;
  const tools = await import("../src/lib/agent/tools");
  const found = await tools.webSearch({ query: "mills" }, { searchApiKey: null, searxngUrl: `http://127.0.0.1:${searxPort}` });
  check("web_search asks the owner's SearXNG first, and says so", [found.output.startsWith("Web search results (SearXNG)"), found.output.includes("https://example.org/mill"), found.output.includes("asked: mills")], [true, true, true]);
  searx.close();
  check("DuckDuckGo's plain page is read, its redirects unwrapped and adverts dropped", tools.parseDuckHtml(
    '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa&amp;rut=x">A &amp; B</a><a class="result__snippet" href="#">About <b>A</b></a>' +
      '<a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a><a class="result__snippet">ad</a>',
  ).map((r) => [r.title, r.url]), [["A & B", "https://example.org/a"]]);
  check("fetch_url's links: absolute, once each, with their text", tools.pageLinks('<a href="/b">B page</a> <a href="https://x.org/c">C</a> <a href="/b">again</a> <a href="#top">top</a> <a href="mailto:a@b">m</a>', "https://example.org/a/"), ["- B page: https://example.org/b", "- C: https://x.org/c"]);
  check("the search key is kept from the model and the page", [tools.SECRET_COLUMN.test("search_api_key"), "searchApiKey" in (await (await (await import("../src/app/api/settings/route")).GET()).json()).settings], [true, false]);

  // Tavily: with the owner's key, or without one (its keyless mode), so the
  // village can search the whole web out of the box.
  const tavilySeen: Array<{ auth?: string; mode?: string; body: { query: string; max_results: number } }> = [];
  let tavilyLimited = false;
  const tavily = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      tavilySeen.push({ auth: req.headers.authorization, mode: req.headers["x-tavily-access-mode"] as string | undefined, body: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization === "Bearer tvly-bad") return void res.writeHead(401).end("{}");
      if (tavilyLimited && !req.headers.authorization) return void res.end(JSON.stringify({ detail: "You've used today's keyless searches. Get a free key at app.tavily.com." }));
      res.end(JSON.stringify({ results: [{ title: "Persian windmills", url: "https://example.org/asbad", content: "Vertical-axis mills\n\nof Nashtifan, still sailing." }] }));
    });
  });
  await new Promise<void>((r) => tavily.listen(0, "127.0.0.1", r));
  process.env.AUTARCH_TAVILY_URL = `http://127.0.0.1:${(tavily.address() as { port: number }).port}/search`;
  const keyless = await tools.webSearch({ query: "windmills", maxResults: 3 }, { searchApiKey: null, searxngUrl: null });
  check("with no keys, web_search uses Tavily without a key, and says so", [keyless.output.startsWith("Web search results (Tavily, without a key)"), keyless.output.includes("https://example.org/asbad\n   Vertical-axis mills of Nashtifan, still sailing."), tavilySeen[0].mode, tavilySeen[0].auth, tavilySeen[0].body.max_results], [true, true, "keyless", undefined, 3]);
  const keyed = await tools.webSearch({ query: "windmills" }, { searchApiKey: null, searxngUrl: null, tavilyApiKey: "tvly-good" });
  check("with the owner's Tavily key, it goes first, with the key", [keyed.output.startsWith("Web search results (Tavily)"), tavilySeen.at(-1)!.auth, tavilySeen.at(-1)!.mode], [true, "Bearer tvly-good", undefined]);
  check("a wrong key is said plainly", await tools.tavilySearch("x", 3, "tvly-bad").catch((e: Error) => e.message), "Tavily answered 401 (is the key right?)");
  tavilyLimited = true;
  check("when the keyless searches run out (Tavily answers in words), the next engine is tried", await tools.tavilySearch("x", 3, null).catch((e: Error) => e.message), "Tavily's keyless searches are used up for now");
  tavily.close();
  delete process.env.AUTARCH_TAVILY_URL;
  check("the Tavily key is a secret too", [tools.SECRET_COLUMN.test("tavily_api_key"), "tavilyApiKey" in (await (await (await import("../src/app/api/settings/route")).GET()).json()).settings], [true, false]);

  // DeepSeek's own search (#192), on the village's DeepSeek key, counted in the spend.
  check("the DeepSeek key is never sent to a server that isn't DeepSeek's", await tools.deepseekSearchKey(), null);
  const dsSeen: Array<{ auth?: string; body: { query: string; count: number } }> = [];
  let dsEmpty = false;
  const ds = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      dsSeen.push({ auth: req.headers.authorization, body: body ? JSON.parse(body) : { query: "", count: 0 } });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ results: dsEmpty ? [] : [{ title: "Post mill", url: "https://example.org/post-mill", snippet: "short", summary: "The post mill\nturned on one post.", site_name: "Mills", date: "2026-05-01T00:00:00+00:00", rerank_score: 2.1, authority: 3 }] }));
    });
  });
  await new Promise<void>((r) => ds.listen(0, "127.0.0.1", r));
  process.env.AUTARCH_DEEPSEEK_SEARCH_URL = `http://127.0.0.1:${(ds.address() as { port: number }).port}/v1/tools/search`;
  const dsFound = await tools.webSearch({ query: "post mill ".repeat(20), maxResults: 4 }, { searchApiKey: null, searxngUrl: null, tavilyApiKey: "tvly-good" });
  check("DeepSeek's search goes first, with the village's key, and says so", [dsFound.output.startsWith("Web search results (DeepSeek)"), dsSeen[0].auth, dsSeen[0].body.count, [...dsSeen[0].body.query].length <= 128], [true, "Bearer test-key", 4, true]);
  check("…its summary, site and date, on one line", dsFound.output.includes("Mills · 2026-05-01 · The post mill turned on one post."), true);
  check("…and what it cost", dsFound.costUsd, tools.DEEPSEEK_SEARCH_USD);
  check("…site names that come hex-encoded are read", [tools.siteName("486973746f72696320456e676c616e64"), tools.siteName("Mills"), tools.siteName("cafe"), tools.siteName(null)], ["Historic England", "Mills", "cafe", null]);
  // Switched off: the next engine answers (a local stand-in for a SearXNG here).
  const off = await tools.webSearch({ query: "x" }, { searchApiKey: null, searxngUrl: `http://127.0.0.1:${(ds.address() as { port: number }).port}/`, tavilyApiKey: null, deepseekSearch: false });
  check("switched off, it isn't used", [off.output.startsWith("Web search results (SearXNG)"), dsSeen.at(-1)!.auth, off.costUsd], [true, undefined, undefined]);
  dsEmpty = true;
  check("a search that finds nothing costs nothing", (await tools.deepseekSearch("x", 3, { key: "k", url: process.env.AUTARCH_DEEPSEEK_SEARCH_URL })).length, 0);
  dsEmpty = false;
  // In a turn: the search's cost goes on the turn's spend.
  const searcher = await villagers.createVillager({ name: "Sage", role: "Scholar", enabledTools: ["web_search"] });
  fake.byAgent.Sage = [{ tools: [{ name: "web_search", args: { query: "windmills" } }] }, { text: "Found it." }];
  const searchTurn = await runAgentTurn({ userMessage: "look up windmills", agentId: searcher.id });
  const turnCost = (sqlite.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM work_sessions WHERE conversation_id = ?").get(searchTurn.conversationId) as { c: number }).c;
  check("a villager's search is counted in what their turn spent", turnCost >= tools.DEEPSEEK_SEARCH_USD, true);
  ds.close();
  delete process.env.AUTARCH_DEEPSEEK_SEARCH_URL;
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
