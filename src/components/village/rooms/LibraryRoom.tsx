"use client";

import { useState } from "react";
import { MAX_SKILL_CHARS, skillTitle, useSkills, type SkillRow } from "../../data/useSkills";
import { SKILLS_IN_PROMPT } from "@/lib/agent/limits";
import { STARTER_SKILLS } from "@/lib/agent/starterSkills";
import ParchmentDialog, { ConfirmDialog } from "../ParchmentDialog";
import type { RoomProps } from "./types";
import DocumentShelf from "./DocumentShelf";
import ResearchDesk from "./ResearchDesk";

// The library: skills are books on the shelves; new ones are written at the
// desk. Same data and actions as the Skills page (useSkills).

type View = { kind: "shelves" } | { kind: "book"; name: string; saved?: boolean } | { kind: "desk" };

function initialView(action: string): View {
  return action === "skills.new" ? { kind: "desk" } : { kind: "shelves" };
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// The reading table opens the document shelf (#169), the research board the
// research desk (#170); the rest is the skills.
export default function LibraryRoom(props: RoomProps) {
  if (props.action === "library.documents") return <DocumentShelf onClose={props.onClose} />;
  if (props.action === "library.research") return <ResearchDesk onClose={props.onClose} />;
  return <SkillsLibrary {...props} />;
}

function SkillsLibrary({ action, onClose }: RoomProps) {
  const { skills, loaded, save, remove } = useSkills();
  const [view, setView] = useState<View>(() => initialView(action));
  const [adding, setAdding] = useState<string | null>(null);
  const [starterError, setStarterError] = useState<string | null>(null);
  const onShelf = new Set(skills.map((s) => skillTitle(s.name)));
  const starters = STARTER_SKILLS.filter((st) => !onShelf.has(st.name));

  async function addStarter(name: string, content: string) {
    setAdding(name);
    setStarterError(null);
    const res = await save({ name, content, isNew: true });
    if (!res.ok) setStarterError(res.error);
    setAdding(null);
  }

  if (view.kind === "desk") {
    return (
      <SkillEditor
        key="new"
        skill={null}
        onSave={async (name, content) => {
          const res = await save({ name, content, isNew: true });
          if (res.ok) setView({ kind: "book", name: `${skillTitle(name.trim())}.md`, saved: true });
          return res;
        }}
        onBack={() => setView({ kind: "shelves" })}
        onClose={onClose}
      />
    );
  }

  if (view.kind === "book") {
    const skill = skills.find((s) => s.name === view.name);
    if (!skill) {
      return (
        <ParchmentDialog kicker="The library" title="Book not found" onClose={onClose}>
          <p className="text-sm">{loaded ? "This skill isn't on the shelves any more." : "Fetching the book…"}</p>
          <button onClick={() => setView({ kind: "shelves" })} className="village-btn mt-3 px-3 py-2 text-xs">
            Back to the shelves
          </button>
        </ParchmentDialog>
      );
    }
    return (
      <SkillEditor
        key={skill.name}
        skill={skill}
        savedNote={view.saved}
        onSave={(name, content) => save({ name, content, isNew: false })}
        onDelete={async () => {
          await remove(skill.name);
          setView({ kind: "shelves" });
        }}
        onBack={() => setView({ kind: "shelves" })}
        onClose={onClose}
      />
    );
  }

  return (
    <ParchmentDialog
      kicker="The library"
      title="Bookshelves"
      onClose={onClose}
      wide
      footer={
        <button onClick={() => setView({ kind: "desk" })} className="village-btn village-btn-primary px-3 py-2 text-xs">
          ✒ Write a new skill
        </button>
      }
    >
      <p className="mb-3 text-xs text-[#6b4a2e]">
        Each book is one of the agent&apos;s skills: a markdown playbook it reads at the start of every session. It reads
        the first {SKILLS_IN_PROMPT} books (alphabetically), and the first {MAX_SKILL_CHARS.toLocaleString()} characters of
        each. Every book is sent with every model call, so each one costs a little.
      </p>
      {!loaded && <p className="text-sm">Dusting the shelves…</p>}
      {loaded && skills.length === 0 && (
        <p className="rounded border-2 border-dashed border-[#c9b27a] p-4 text-center text-sm">
          The shelves are empty. Write the first skill at the desk.
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {skills.map((s, i) => (
          <li key={s.name}>
            <button
              onClick={() => setView({ kind: "book", name: s.name })}
              className="flex w-full items-start gap-3 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2 text-left hover:bg-white focus-visible:outline-4 focus-visible:outline-[#e3b04b]"
            >
              <span aria-hidden className="mt-0.5 text-lg">
                📕
              </span>
              <span className="min-w-0 flex-1">
                <span className="village-pixel block truncate text-sm">{skillTitle(s.name)}</span>
                <span className="block text-[11px] text-[#6b4a2e]">
                  {s.size.toLocaleString()} bytes · {when(s.modifiedAt)}
                </span>
                {s.truncatedInPrompt && (
                  <span className="mt-1 inline-block rounded bg-[#fbe3d8] px-1.5 text-[11px] text-[#b3261e]">
                    Too long — the agent only reads the first {MAX_SKILL_CHARS.toLocaleString()} characters
                  </span>
                )}
                {i >= SKILLS_IN_PROMPT && (
                  <span className="mt-1 inline-block rounded bg-[#fbe3d8] px-1.5 text-[11px] text-[#b3261e]">
                    Not read — only the first {SKILLS_IN_PROMPT} books reach the agent
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {loaded && starters.length > 0 && (
        <section className="mt-5 border-t-2 border-dashed border-[#c9b27a] pt-3">
          <h3 className="village-pixel text-sm">Starter books</h3>
          <p className="mb-2 text-xs text-[#6b4a2e]">
            Ready-made playbooks you can put on the shelf. Add only the ones you want the agent to follow.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {starters.map((st) => (
              <li key={st.name} className="flex items-start gap-3 rounded border-2 border-dashed border-[#3b2716] bg-[#fffaf0]/70 px-3 py-2">
                <span aria-hidden className="mt-0.5 text-lg">
                  📗
                </span>
                <span className="min-w-0 flex-1">
                  <span className="village-pixel block truncate text-sm">{st.name}</span>
                  <span className="block text-[11px] text-[#6b4a2e]">{st.summary}</span>
                  <button
                    onClick={() => void addStarter(st.name, st.content)}
                    disabled={adding !== null}
                    className="village-btn mt-2 px-2 py-1 text-[11px]"
                  >
                    {adding === st.name ? "Adding…" : "+ Add to the shelf"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {starterError && <p className="mt-2 text-xs text-[#b3261e]">{starterError}</p>}
        </section>
      )}
    </ParchmentDialog>
  );
}

function SkillEditor({
  skill,
  savedNote,
  onSave,
  onDelete,
  onBack,
  onClose,
}: {
  skill: SkillRow | null;
  savedNote?: boolean;
  onSave: (name: string, content: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDelete?: () => Promise<void>;
  onBack: () => void;
  onClose: () => void;
}) {
  const creating = !skill;
  const [name, setName] = useState(skill ? skillTitle(skill.name) : "");
  const [content, setContent] = useState(skill?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(savedNote ? { text: "Saved.", ok: true } : null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tooLong = content.length > MAX_SKILL_CHARS;

  async function submit() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await onSave(name, content);
      setMsg(res.ok ? { text: "Saved.", ok: true } : { text: res.error, ok: false });
    } finally {
      setSaving(false);
    }
  }

  if (confirmDelete && skill && onDelete) {
    return (
      <ConfirmDialog
        title="Remove this book?"
        message={
          <>
            Delete the skill <strong>{skillTitle(skill.name)}</strong>? The agent will no longer read it. This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete skill"
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    );
  }

  return (
    <ParchmentDialog
      kicker={creating ? "The writing desk" : "The library"}
      title={creating ? "Write a new skill" : skillTitle(skill.name)}
      onClose={onClose}
      wide
      footer={
        <>
          <button
            onClick={() => void submit()}
            disabled={saving || !name.trim()}
            className="village-btn village-btn-primary px-4 py-2 text-xs"
          >
            {saving ? "Saving…" : creating ? "Put it on the shelf" : "Save changes"}
          </button>
          {!creating && onDelete && (
            <button onClick={() => setConfirmDelete(true)} className="village-btn village-btn-danger px-3 py-2 text-xs">
              Delete
            </button>
          )}
          <button onClick={onBack} className="village-btn ml-auto px-3 py-2 text-xs">
            ← Back to the shelves
          </button>
        </>
      }
    >
      <label className="block text-xs font-semibold">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={!creating}
          data-autofocus={creating ? true : undefined}
          placeholder="e.g. deploy-checklist"
          className={`mt-1 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm font-normal outline-none ${
            creating ? "" : "opacity-70"
          }`}
        />
      </label>
      <label className="mt-3 block text-xs font-semibold">
        Playbook (markdown)
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={14}
          data-autofocus={creating ? undefined : true}
          placeholder={"# My skill\n\nStep-by-step playbook the agent should follow..."}
          className="mt-1 w-full resize-y rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 font-mono text-xs font-normal outline-none"
        />
      </label>
      <p className={`mt-1 text-[11px] ${tooLong ? "text-[#b3261e]" : "text-[#6b4a2e]"}`}>
        {content.length.toLocaleString()} / {MAX_SKILL_CHARS.toLocaleString()} characters reach the agent
        {tooLong && " — the rest will be cut off in its prompt."}
      </p>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-[#3f6b22]" : "text-[#b3261e]"}`}>{msg.text}</p>}
    </ParchmentDialog>
  );
}
