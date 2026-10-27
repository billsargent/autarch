"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";
import MarkdownReader from "./MarkdownReader";

// The document shelf in the library (#169): your documents and the village's
// research reports, to read in the page or download. Villagers you tick can
// read them with read_document; nobody else can reach them.

interface Doc {
  shelf: "documents" | "research";
  name: string;
  size: number;
  modified: string;
  type: string;
}

const SHELF_TITLE = { documents: "Your documents", research: "Research reports" } as const;
const IN_PAGE = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp"]);
const AS_TEXT = new Set(["txt", "md", "csv", "json", "rtf"]);
const href = (d: Doc) => `/api/library/${d.shelf}/${encodeURIComponent(d.name)}`;
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function DocumentShelf({ onClose, initial }: { onClose: () => void; initial?: { shelf: Doc["shelf"]; name: string } }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [readers, setReaders] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Doc | null>(null);
  const [text, setText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { villagers } = useVillagers(30000);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/library", { cache: "no-store" }).then((r) => r.json());
      setDocs(d.documents ?? []);
      setReaders(d.readers ?? []);
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  // Straight to one document (a report from the research desk).
  const opened = useRef(false);
  useEffect(() => {
    if (!initial || opened.current || !docs) return;
    const d = docs.find((x) => x.shelf === initial.shelf && x.name === initial.name);
    if (!d) return;
    opened.current = true;
    const t = setTimeout(() => void read(d), 0);
    return () => clearTimeout(t);
  }, [docs, initial]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/library", { method: "POST", body: form });
      if (!res.ok) setError(`${file.name}: ${(await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`}`);
    }
    if (fileRef.current) fileRef.current.value = "";
    setBusy(false);
    await load();
  }

  async function remove(d: Doc) {
    if (!window.confirm(`Take "${d.name}" off the shelf? It's deleted.`)) return;
    const res = await fetch(href(d), { method: "DELETE" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    if (open?.name === d.name && open.shelf === d.shelf) setOpen(null);
    await load();
  }

  async function read(d: Doc) {
    setOpen(d);
    setText(null);
    if (AS_TEXT.has(d.type)) setText(await fetch(href(d)).then((r) => r.text()).catch(() => "Couldn't open it."));
  }

  async function setReader(id: number, on: boolean) {
    const next = on ? [...readers, id] : readers.filter((r) => r !== id);
    const res = await fetch("/api/library", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ readers: next }) });
    if (res.ok) setReaders((await res.json()).readers ?? next);
  }

  if (open) {
    return (
      <ParchmentDialog kicker={`The library · ${SHELF_TITLE[open.shelf]}`} title={open.name} onClose={onClose} wide tall>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button onClick={() => setOpen(null)} className="village-btn px-2 py-1 text-[11px]">
            ← Back to the shelf
          </button>
          <a href={`${href(open)}?download=1`} className="village-btn px-2 py-1 text-[11px]">
            ⬇ Download
          </a>
        </div>
        {open.type === "pdf" && <iframe title={open.name} src={href(open)} className="h-[65vh] w-full rounded border-2 border-[#3b2716] bg-white" />}
        {IN_PAGE.has(open.type) && open.type !== "pdf" && (
          // A picture fits the viewer whatever its size, keeping its shape;
          // click it for the full size.
          <div className="flex h-[65vh] items-center justify-center rounded border-2 border-[#3b2716] bg-[#2b1d10]/5 p-1">
            <a href={href(open)} target="_blank" rel="noreferrer" title="Open at full size" className="flex h-full w-full items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={href(open)} alt={open.name} className="block h-auto max-h-full w-auto max-w-full object-contain" />
            </a>
          </div>
        )}
        {open.type === "md" && <MarkdownReader text={text} />}
        {open.type === "html" && <iframe title={open.name} sandbox="" src={href(open)} className="h-[65vh] w-full rounded border-2 border-[#3b2716] bg-white" />}
        {AS_TEXT.has(open.type) && open.type !== "md" && (
          <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded border-2 border-[#3b2716] bg-white p-3 font-mono text-[12px]">{text ?? "Opening…"}</pre>
        )}
        {!IN_PAGE.has(open.type) && !AS_TEXT.has(open.type) && open.type !== "html" && (
          <p className="text-sm">This kind of document opens in its own program: download it.</p>
        )}
      </ParchmentDialog>
    );
  }

  return (
    <ParchmentDialog kicker="The library" title="The document shelf" onClose={onClose} wide>
      <p className="mb-2 text-xs text-[#6b4a2e]">
        Documents you keep here (PDFs, text, Word files, pictures) and the village&apos;s research reports. They&apos;re kept next to the
        village&apos;s records, out of the villagers&apos; workspace: only villagers you tick below can read them, and only as reading.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" multiple onChange={(e) => void upload(e.target.files)} className="hidden" id="shelf-upload" name="shelfUpload" />
        <label htmlFor="shelf-upload" className={`village-btn village-btn-go cursor-pointer px-3 py-1.5 text-xs ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? "Shelving…" : "📥 Put documents on the shelf"}
        </label>
        <span className="text-[11px] text-[#6b4a2e]">Up to 50 MB each.</span>
      </div>
      {error && <p role="alert" className="mb-2 text-xs text-[#b3261e]">{error}</p>}
      {!docs && <p className="text-sm">Dusting the shelves…</p>}
      {docs &&
        (["documents", "research"] as const).map((shelf) => {
          const here = docs.filter((d) => d.shelf === shelf);
          return (
            <section key={shelf} className="mb-3">
              <p className="text-xs font-semibold">
                {SHELF_TITLE[shelf]} ({here.length})
              </p>
              {here.length === 0 ? (
                <p className="text-[11px] text-[#6b4a2e]">{shelf === "documents" ? "Nothing yet." : "No research yet: commission some at the research desk."}</p>
              ) : (
                <ul className="mt-1 divide-y-2 divide-[#e6d6b0] rounded border-2 border-[#3b2716] bg-[#fffaf0] text-xs">
                  {here.map((d) => (
                    <li key={d.name} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                      <button onClick={() => void read(d)} className="min-w-0 flex-1 truncate text-left font-semibold underline-offset-2 hover:underline">
                        📄 {d.name}
                      </button>
                      <span className="text-[#6b4a2e]">
                        {d.type.toUpperCase()} · {kb(d.size)} · {new Date(d.modified).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                      <a href={`${href(d)}?download=1`} className="village-btn px-1.5 py-0.5 text-[10px]" aria-label={`Download ${d.name}`}>
                        ⬇
                      </a>
                      <button onClick={() => void remove(d)} className="village-btn village-btn-danger px-1.5 py-0.5 text-[10px]" aria-label={`Remove ${d.name}`}>
                        🗑
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      <fieldset className="text-xs">
        <legend className="font-semibold">Who may read the shelves</legend>
        <p className="text-[11px] text-[#6b4a2e]">Nobody, unless you tick them. They get a read-only read_document tool.</p>
        <div className="mt-1 flex flex-wrap gap-x-3">
          {villagers.map((v) => (
            <label key={v.id} className="flex items-center gap-1">
              <input type="checkbox" checked={readers.includes(v.id)} onChange={(e) => void setReader(v.id, e.target.checked)} />
              {v.name}
            </label>
          ))}
        </div>
      </fieldset>
    </ParchmentDialog>
  );
}
