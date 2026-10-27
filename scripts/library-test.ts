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
