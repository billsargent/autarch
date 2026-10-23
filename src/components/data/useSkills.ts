"use client";

import { useCallback, useEffect, useState } from "react";
import { SKILL_PROMPT_CHARS } from "@/lib/agent/limits";

// Skills: the agent's markdown playbooks. Shared by the Skills page and the
// library in the village, so both always behave the same.

export interface SkillRow {
  name: string;
  content: string;
  size: number;
  modifiedAt: string;
  truncatedInPrompt: boolean;
}

// Characters of a skill that reach the agent's prompt; anything longer is cut.
export const MAX_SKILL_CHARS = SKILL_PROMPT_CHARS;

// "deploy.md" → "deploy"
export function skillTitle(name: string): string {
  return name.replace(/\.md$/i, "");
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export function useSkills() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async (): Promise<SkillRow[]> => {
    const res = await fetch("/api/skills").then((r) => r.json());
    const list: SkillRow[] = res.skills || [];
    setSkills(list);
    setLoaded(true);
    return list;
  }, []);

  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  // Create a new skill, or replace the content of an existing one.
  const save = useCallback(
    async (input: { name: string; content: string; isNew: boolean }): Promise<SaveResult> => {
      const name = skillTitle(input.name.trim());
      if (!name) return { ok: false, error: "A name is required." };
      const res = input.isNew
        ? await fetch("/api/skills", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, content: input.content }),
          })
        : await fetch(`/api/skills/${encodeURIComponent(name)}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: input.content }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "Failed to save." };
      await reload();
      return { ok: true };
    },
    [reload],
  );

  // Delete a skill. Callers confirm with the human first.
  const remove = useCallback(
    async (name: string) => {
      await fetch(`/api/skills/${encodeURIComponent(skillTitle(name))}`, { method: "DELETE" });
      await reload();
    },
    [reload],
  );

  return { skills, loaded, reload, save, remove };
}
