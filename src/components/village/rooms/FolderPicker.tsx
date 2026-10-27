"use client";

import { useCallback, useEffect, useState } from "react";
import ParchmentDialog from "../ParchmentDialog";

// Pick the agent's workspace (#157): walk the folders on this computer (names
// only), make a new one, and use it. The server says when a folder can't be a
// workspace (a system folder, a drive's root, the home folder itself…).

interface Listing {
  path: string;
  parent: string | null;
  folders: string[];
  drives: string[];
  home: string;
  problem: string | null;
  sep: string;
}

export default function FolderPicker({ start, onPick, onClose }: { start: string; onPick: (path: string) => void; onClose: () => void }) {
  const [list, setList] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  const go = useCallback(async (where: string) => {
    setError(null);
    const res = await fetch(`/api/fs/folders?path=${encodeURIComponent(where)}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setList(data);
    else setError(data.error ?? `HTTP ${res.status}`);
    return res.ok;
  }, []);

  // Start in the current workspace (or its nearest folder that exists), else home.
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!(await go(start))) await go("");
    }, 0);
    return () => clearTimeout(t);
  }, [go, start]);

  async function makeFolder() {
    if (!list) return;
    setError(null);
    const res = await fetch("/api/fs/folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: list.path, name }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setList(data);
      setName("");
    } else setError(data.error ?? `HTTP ${res.status}`);
  }

  const join = (dir: string, child: string) => (dir.endsWith(list?.sep ?? "/") ? `${dir}${child}` : `${dir}${list?.sep ?? "/"}${child}`);
  return (
    <ParchmentDialog kicker="The Mayor's ledger" title="Choose the workspace" onClose={onClose} wide>
      <p className="mb-2 text-xs text-[#6b4a2e]">
        The villagers&apos; own folder on this computer: everything they make goes here, and working in it is always low risk. Pick a folder of
        its own, not a system folder, a drive&apos;s root or your home folder itself.
      </p>
      {!list && !error && <p className="text-sm">Looking around…</p>}
      {list && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button onClick={() => list.parent && void go(list.parent)} disabled={!list.parent} className="village-btn px-2 py-1 text-[11px] disabled:opacity-40">
              ⬆ Up
            </button>
            <button onClick={() => void go(list.home)} className="village-btn px-2 py-1 text-[11px]">
              🏠 Home
            </button>
            {list.drives.map((d) => (
              <button key={d} onClick={() => void go(d)} className="village-btn px-2 py-1 text-[11px]">
                💽 {d.slice(0, 2)}
              </button>
            ))}
          </div>
          <p className="mt-2 break-all rounded bg-[#f4ead5] px-2 py-1 font-mono text-[12px]">{list.path}</p>
          <ul className="mt-1 max-h-64 overflow-auto rounded border-2 border-[#3b2716] bg-[#fffaf0] text-xs">
            {list.folders.length === 0 && <li className="px-2 py-1 text-[#6b4a2e]">No folders in here.</li>}
            {list.folders.map((f) => (
              <li key={f}>
                <button onClick={() => void go(join(list.path, f))} className="block w-full px-2 py-1 text-left hover:bg-[#f4ead5]">
                  📁 {f}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-1.5">
            <input
              name="newFolder"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New folder name, e.g. agent-workspace"
              className="flex-1 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 text-xs"
            />
            <button onClick={() => void makeFolder()} disabled={!name.trim()} className="village-btn px-2 py-1 text-[11px] disabled:opacity-50">
              ➕ Make it here
            </button>
          </div>
          {list.problem && <p className="mt-2 text-xs text-[#b3261e]">{list.problem}</p>}
          <div className="mt-3 flex gap-1.5">
            <button onClick={() => onPick(list.path)} disabled={Boolean(list.problem)} className="village-btn village-btn-go px-3 py-1.5 text-xs disabled:opacity-50">
              Use this folder
            </button>
            <button onClick={onClose} className="village-btn px-3 py-1.5 text-xs">
              Cancel
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-[#b3261e]">{error}</p>}
    </ParchmentDialog>
  );
}
