import zlib from "node:zlib";

// The research desk's report formats (#170). The report is written as
// markdown; this turns it into what the owner chose: markdown itself, a web
// page, plain text, a Word document or a PDF. A small reader of its own
// (headings, paragraphs, lists, quotes, code, tables; bold, italics, code and
// links inside a line) is enough for a report and keeps the formats alike.

export const FORMATS = {
  md: { ext: ".md", label: "Markdown (opens in the library's reader)" },
  html: { ext: ".html", label: "Web page" },
  txt: { ext: ".txt", label: "Plain text" },
  docx: { ext: ".docx", label: "Word document" },
  pdf: { ext: ".pdf", label: "PDF" },
} as const;
export type ReportFormat = keyof typeof FORMATS;
export const isFormat = (f: unknown): f is ReportFormat => typeof f === "string" && f in FORMATS;

// --- reading the markdown -----------------------------------------------------------------

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}
export type Block =
  | { kind: "heading"; level: number; runs: Run[] }
  | { kind: "para"; runs: Run[] }
  | { kind: "item"; ordered: number | null; runs: Run[] }
  | { kind: "quote"; runs: Run[] }
  | { kind: "code"; text: string }
  | { kind: "table"; rows: Run[][][] }
  | { kind: "rule" };

// One line's inline markup: **bold**, *italic* or _italic_, `code`,
// [text](address) and <address>.
export function inline(text: string, base: Omit<Run, "text"> = {}): Run[] {
  const out: Run[] = [];
  const re = /(\*\*|__)(.+?)\1|(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\3(?![\w*])|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ ...base, text: text.slice(at, m.index) });
    if (m[2] != null) out.push(...inline(m[2], { ...base, bold: true }));
    else if (m[4] != null) out.push(...inline(m[4], { ...base, italic: true }));
    else if (m[5] != null) out.push({ ...base, text: m[5], code: true });
    else if (m[6] != null) out.push(...inline(m[6], { ...base, link: m[7] }));
    else if (m[8] != null) out.push({ ...base, text: m[8], link: m[8] });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ ...base, text: text.slice(at) });
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", runs: inline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (!t) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(t);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1].length, runs: inline(h[2]) });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(t)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    if (t.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      flush();
      const rows = [cells(t).map((c) => inline(c, { bold: true }))];
      for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(cells(lines[i]).map((c) => inline(c)));
      i--;
      blocks.push({ kind: "table", rows });
      continue;
    }
    const item = /^(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(t);
    if (item) {
      flush();
      blocks.push({ kind: "item", ordered: item[1] ? Number(item[1]) : null, runs: inline(item[2]) });
      continue;
    }
    if (t.startsWith(">")) {
      flush();
      blocks.push({ kind: "quote", runs: inline(t.replace(/^>\s?/, "")) });
      continue;
    }
    para.push(t);
  }
  flush();
  return blocks;
}


// --- the formats ------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeHref = (u: string) => (/^(https?:|mailto:|#)/i.test(u) ? u : "#");

function runsHtml(runs: Run[]): string {
  return runs
    .map((r) => {
      let s = esc(r.text);
      if (r.code) s = `<code>${s}</code>`;
      if (r.italic) s = `<em>${s}</em>`;
      if (r.bold) s = `<strong>${s}</strong>`;
      if (r.link) s = `<a href="${esc(safeHref(r.link))}" target="_blank" rel="noopener noreferrer">${s}</a>`;
      return s;
    })
    .join("");
}

export function toHtml(md: string, title: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const b of parseMarkdown(md)) {
    if (b.kind === "item") {
      const want = b.ordered != null ? "ol" : "ul";
      if (list !== want) {
        close();
        out.push(want === "ol" && b.ordered !== 1 ? `<ol start="${b.ordered}">` : `<${want}>`);
        list = want;
      }
      out.push(`<li>${runsHtml(b.runs)}</li>`);
      continue;
    }
    close();
    if (b.kind === "heading") out.push(`<h${b.level}>${runsHtml(b.runs)}</h${b.level}>`);
    else if (b.kind === "para") out.push(`<p>${runsHtml(b.runs)}</p>`);
    else if (b.kind === "quote") out.push(`<blockquote>${runsHtml(b.runs)}</blockquote>`);
    else if (b.kind === "code") out.push(`<pre><code>${esc(b.text)}</code></pre>`);
    else if (b.kind === "rule") out.push("<hr>");
    else if (b.kind === "table")
      out.push(`<table>${b.rows.map((row, i) => `<tr>${row.map((c) => (i === 0 ? `<th>${runsHtml(c)}</th>` : `<td>${runsHtml(c)}</td>`)).join("")}</tr>`).join("")}</table>`);
  }
  close();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { font: 16px/1.6 Georgia, "Times New Roman", serif; color: #2b1d10; background: #fbf6ea; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
  h1, h2, h3 { font-family: system-ui, sans-serif; line-height: 1.25; }
  a { color: #7a3b12; }
  code, pre { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; }
  pre { background: #f1e7d0; padding: 0.75rem; overflow-x: auto; }
  blockquote { border-left: 3px solid #c9a96a; margin-left: 0; padding-left: 1rem; color: #5a4128; }
  table { border-collapse: collapse; margin: 1rem 0; }
  th, td { border: 1px solid #c9a96a; padding: 0.3rem 0.6rem; text-align: left; }
  @media print { body { background: #fff; margin: 0; } }
</style>
</head>
<body>
${out.join("\n")}
</body>
</html>
`;
}

export function toText(md: string): string {
  const out: string[] = [];
  const line = (runs: Run[]) => runs.map((r) => (r.link && r.link !== r.text ? `${r.text} (${r.link})` : r.text)).join("");
  for (const b of parseMarkdown(md)) {
    if (b.kind === "heading") {
      const t = line(b.runs);
      out.push("", t, (b.level === 1 ? "=" : "-").repeat(Math.min(t.length, 72)), "");
    } else if (b.kind === "para") out.push(line(b.runs), "");
    else if (b.kind === "item") out.push(`${b.ordered != null ? `${b.ordered}.` : "  -"} ${line(b.runs)}`);
    else if (b.kind === "quote") out.push(`  > ${line(b.runs)}`);
    else if (b.kind === "code") out.push(b.text, "");
    else if (b.kind === "rule") out.push("-".repeat(40), "");
    else if (b.kind === "table") out.push(...b.rows.map((row) => row.map(line).join(" | ")), "");
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

// --- Word ------------------------------------------------------------------------------

// A .docx is a zip of a few XML files: the zip is written here with Node's own
// deflate, so Word documents need no library.
function zip(files: Array<[string, string]>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, "utf-8");
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const nameBuf = Buffer.from(name, "utf-8");
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // names in UTF-8
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt32LE(0, 10); // time and date: 1980, which Word doesn't mind
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, nameBuf, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export function toDocx(md: string, title: string): Buffer {
  const links: string[] = [];
  const runXml = (r: Run, extra = "") => {
    const props = `${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}${r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ""}${r.link ? '<w:rStyle w:val="Hyperlink"/>' : ""}${extra}`;
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
  };
  const runsXml = (runs: Run[]) =>
    runs
      .map((r) => {
        if (!r.link || !/^https?:/i.test(r.link)) return runXml(r);
        links.push(r.link);
        return `<w:hyperlink r:id="rLink${links.length}">${runXml(r)}</w:hyperlink>`;
      })
      .join("");
  const para = (style: string | null, inner: string, extra = "") => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : ""}${inner}</w:p>`;
  const body = parseMarkdown(md)
    .map((b) => {
      if (b.kind === "heading") return para(b.level === 1 ? "Title" : `Heading${Math.min(b.level - 1, 3)}`, runsXml(b.runs));
      if (b.kind === "para") return para(null, runsXml(b.runs));
      if (b.kind === "item") return para("ListParagraph", runXml({ text: b.ordered != null ? `${b.ordered}.\t` : "•\t" }) + runsXml(b.runs));
      if (b.kind === "quote") return para("Quote", runsXml(b.runs));
      if (b.kind === "code") return b.text.split("\n").map((l) => para("Code", runXml({ text: l, code: true }))).join("");
      if (b.kind === "rule") return para(null, "", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9A96A"/></w:pBdr>');
      return `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${b.rows
        .map((row) => `<w:tr>${row.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(null, runsXml(c))}</w:tc>`).join("")}</w:tr>`)
        .join("")}</w:tbl>${para(null, "")}`;
    })
    .join("");
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const style = (id: string, name: string, rPr: string, pPr = "") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:rPr>${rPr}</w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style("Title", "Title", '<w:b/><w:sz w:val="40"/>', '<w:spacing w:after="240"/>')}
${style("Heading1", "heading 1", '<w:b/><w:sz w:val="32"/><w:color w:val="5A3A1A"/>', '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/>')}
${style("Heading2", "heading 2", '<w:b/><w:sz w:val="26"/><w:color w:val="5A3A1A"/>', '<w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/>')}
${style("Heading3", "heading 3", '<w:b/><w:sz w:val="23"/>', '<w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="2"/>')}
${style("ListParagraph", "List Paragraph", "", '<w:spacing w:after="60"/><w:ind w:left="720" w:hanging="360"/>')}
${style("Quote", "Quote", '<w:i/><w:color w:val="5A4128"/>', '<w:ind w:left="720"/>')}
${style("Code", "Code", '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>', '<w:spacing w:after="0"/>')}
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="C9A96A"/><w:left w:val="single" w:sz="4" w:color="C9A96A"/><w:bottom w:val="single" w:sz="4" w:color="C9A96A"/><w:right w:val="single" w:sz="4" w:color="C9A96A"/><w:insideH w:val="single" w:sz="4" w:color="C9A96A"/><w:insideV w:val="single" w:sz="4" w:color="C9A96A"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1300" w:bottom="1300" w:left="1300" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${links
    .map((l, i) => `<Relationship Id="rLink${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(l).replace(/"/g, "&quot;")}" TargetMode="External"/>`)
    .join("")}</Relationships>`;
  return zip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ],
    [
      "docProps/core.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>Autarch research desk</dc:creator></cp:coreProperties>`,
    ],
    ["word/document.xml", document],
    ["word/styles.xml", styles],
    ["word/_rels/document.xml.rels", rels],
  ]);
}

// --- PDF -------------------------------------------------------------------------------

// pdfkit's built-in fonts cover Western European text. Other accented Latin
// letters lose their accent (ā → a, Ś → S); anything else would print as the
// wrong letters, so it becomes "?". The other formats keep every letter.
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const NO_DECOMPOSE: Record<string, string> = { ł: "l", Ł: "L", đ: "d", Đ: "D", ı: "i", "−": "-", "≈": "~", "→": "->", "←": "<-", "×": "x" };
const printable = (c: string) => c.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.includes(c);
export const pdfSafe = (s: string) =>
  [...s]
    .map((c) => {
      if (printable(c)) return c;
      if (NO_DECOMPOSE[c]) return NO_DECOMPOSE[c];
      const bare = c.normalize("NFD").replace(/\p{M}+/gu, "");
      return bare && [...bare].every(printable) ? bare : "?";
    })
    .join("");

export async function toPdf(md: string, title: string): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 60, info: { Title: pdfSafe(title), Author: "Autarch research desk" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const font = (r: Run) => (r.code ? "Courier" : r.bold && r.italic ? "Helvetica-BoldOblique" : r.bold ? "Helvetica-Bold" : r.italic ? "Helvetica-Oblique" : "Helvetica");
  const write = (runs: Run[], size: number, opts: PDFKit.Mixins.TextOptions = {}) => {
    if (!runs.length) runs = [{ text: "" }];
    runs.forEach((r, i) => {
      doc.font(font(r)).fontSize(size).fillColor(r.link ? "#0563C1" : "#222222");
      doc.text(pdfSafe(r.text), { ...opts, continued: i < runs.length - 1, link: r.link && /^https?:/i.test(r.link) ? r.link : undefined, underline: Boolean(r.link) });
    });
  };
  const left = doc.page.margins.left;
  for (const b of parseMarkdown(md)) {
    doc.x = left;
    if (b.kind === "heading") {
      doc.moveDown(b.level === 1 ? 0 : 0.6);
      write(b.runs.map((r) => ({ ...r, bold: true })), b.level === 1 ? 20 : b.level === 2 ? 15 : 12.5);
      doc.moveDown(0.3);
    } else if (b.kind === "para") {
      write(b.runs, 10.5, { align: "left" });
      doc.moveDown(0.5);
    } else if (b.kind === "item") {
      write([{ text: b.ordered != null ? `${b.ordered}. ` : "•  " }, ...b.runs], 10.5, { indent: 14 });
      doc.moveDown(0.2);
    } else if (b.kind === "quote") {
      write(b.runs.map((r) => ({ ...r, italic: true })), 10.5, { indent: 20 });
      doc.moveDown(0.5);
    } else if (b.kind === "code") {
      write([{ text: b.text, code: true }], 9);
      doc.moveDown(0.5);
    } else if (b.kind === "rule") {
      doc.moveTo(left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#C9A96A").stroke();
      doc.moveDown(0.5);
    } else if (b.kind === "table") {
      for (const row of b.rows) write(row.flatMap((c, i) => (i ? [{ text: "  |  " }, ...c] : c)), 9.5);
      doc.moveDown(0.5);
    }
  }
  doc.end();
  return done;
}

// The report in the chosen format, as bytes for the shelf.
export async function renderReport(md: string, title: string, format: ReportFormat): Promise<Uint8Array> {
  if (format === "html") return new TextEncoder().encode(toHtml(md, title));
  if (format === "txt") return new TextEncoder().encode(toText(md));
  if (format === "docx") return toDocx(md, title);
  if (format === "pdf") return toPdf(md, title);
  return new TextEncoder().encode(md);
}
