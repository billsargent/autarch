"use client";

import { useState } from "react";
import { MAX_SKILL_CHARS, skillTitle, useSkills, type SaveResult, type SkillRow } from "./data/useSkills";

export default function SkillsView() {
  const { skills, save, remove } = useSkills();
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Keep the picked skill if it still exists, otherwise fall back to the first.
  const selected = creating ? null : picked && skills.some((s) => s.name === picked) ? picked : skills[0]?.name ?? null;
  const setSelected = setPicked;

  function startNew() {
    setCreating(true);
    setSelected(null);
    setMsg(null);
  }

  async function removeSkill(name: string) {
    if (!window.confirm(`Delete skill "${name}"?`)) return;
    setMsg(null);
    await remove(name);
  }

  const selectedSkill = skills.find((s) => s.name === selected) ?? null;

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-lg font-semibold">Skills</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Reusable markdown playbooks injected into the agent&apos;s system prompt every session. The agent writes its
          own; you can review, edit, add, or delete them here.
        </p>
        {msg && <p className="mt-3 text-xs text-neutral-400">{msg}</p>}

        <div className="mt-5 flex gap-4">
          <div className="w-64 shrink-0">
            <button
              onClick={startNew}
              className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium hover:bg-neutral-800"
            >
              + New skill
            </button>
            <div className="space-y-1">
              {skills.length === 0 && (
                <p className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-500">
                  No skills yet.
                </p>
              )}
              {skills.map((s) => (
                <div
                  key={s.name}
                  className={`group flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs ${
                    selected === s.name
                      ? "border-blue-700 bg-blue-950/20 text-white"
                      : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  <button
                    onClick={() => {
                      setSelected(s.name);
                      setCreating(false);
                    }}
                    className="flex-1 truncate text-left"
                  >
                    {skillTitle(s.name)}
                    {s.truncatedInPrompt && (
                      <span className="ml-1 text-amber-400" title="Truncated in the prompt">
                        &gt;{MAX_SKILL_CHARS / 1000}k
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => removeSkill(s.name)}
                    title="Delete skill"
                    className="ml-1 hidden text-red-400 hover:text-red-300 group-hover:block"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            {selected || creating ? (
              <SkillEditor
                key={selected ?? "new"}
                skill={selectedSkill}
                creating={creating}
                onSave={save}
                onSaved={(name) => {
                  setMsg("Saved.");
                  setCreating(false);
                  setSelected(`${skillTitle(name.trim())}.md`);
                }}
                onCancel={() => {
                  setCreating(false);
                  setSelected(skills[0]?.name ?? null);
                }}
              />
            ) : (
              <p className="py-10 text-center text-sm text-neutral-500">Select a skill to edit, or create a new one.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillEditor({
  skill,
  creating,
  onSave,
  onSaved,
  onCancel,
}: {
  skill: SkillRow | null;
  creating: boolean;
  onSave: (input: { name: string; content: string; isNew: boolean }) => Promise<SaveResult>;
  onSaved: (name: string) => void;
  onCancel: () => void;
}) {
  const [nameInput, setNameInput] = useState(skill ? skillTitle(skill.name) : "");
  const [contentInput, setContentInput] = useState(skill?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const truncated = contentInput.length > MAX_SKILL_CHARS;

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const result = await onSave({ name: nameInput, content: contentInput, isNew: creating });
      if (!result.ok) {
        setMsg(result.error);
        return;
      }
      onSaved(nameInput);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <label className="block text-xs text-neutral-400">
        Name
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          readOnly={!creating}
          className={`mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none ${
            !creating ? "opacity-60" : ""
          }`}
        />
      </label>
      <label className="mt-3 block text-xs text-neutral-400">
        Markdown content
        <textarea
          value={contentInput}
          onChange={(e) => setContentInput(e.target.value)}
          rows={18}
          placeholder={"# My skill\n\nStep-by-step playbook the agent should follow..."}
          className="mt-1 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200 outline-none"
        />
      </label>
      {msg && <p className="mt-1 text-[11px] text-red-400">{msg}</p>}
      {truncated && (
        <p className="mt-1 text-[11px] text-amber-400">
          This skill exceeds the {MAX_SKILL_CHARS}-char injection budget and will be truncated in the agent&apos;s prompt.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving || !nameInput.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : creating ? "Create skill" : "Save changes"}
        </button>
        {creating && (
          <button
            onClick={onCancel}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
        )}
      </div>
    </>
  );
}
