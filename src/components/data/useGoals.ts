"use client";

import { useCallback, useEffect, useState } from "react";
import type { GoalRow } from "@/lib/agent/clientTypes";
import { fetchConversationChoices, type ConversationChoice } from "./conversationChoices";

// Goals: what the agent works toward in its work windows. Shared by the Goals
// page and the notice board in the village, so both always behave the same.

export const GOAL_STATUSES = ["backlog", "in_progress", "done", "abandoned"] as const;

export const GOAL_STATUS_LABEL: Record<GoalRow["status"], string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  done: "Done",
  abandoned: "Abandoned",
};

export interface GoalInput {
  title: string;
  body: string;
  priority: number;
  // "" = global (work windows).
  conversationId: string;
  // Whose goal; "" = a town goal anyone may pick up.
  agentId: string;
}

export const EMPTY_GOAL: GoalInput = { title: "", body: "", priority: 3, conversationId: "", agentId: "" };

export type GoalPatch = Partial<Pick<GoalRow, "title" | "body" | "status" | "priority" | "conversationId" | "agentId">>;

export function useGoals() {
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [conversations, setConversations] = useState<ConversationChoice[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/goals").then((r) => r.json());
    setGoals(res.goals || []);
    setLoaded(true);
    fetchConversationChoices().then(setConversations);
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    const id = setInterval(reload, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload]);

  const create = useCallback(
    async (input: GoalInput) => {
      if (!input.title.trim()) return;
      await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          priority: input.priority,
          conversationId: input.conversationId || undefined,
          agentId: input.agentId ? Number(input.agentId) : null,
        }),
      });
      await reload();
    },
    [reload],
  );

  const update = useCallback(
    async (id: number, patch: GoalPatch) => {
      await fetch(`/api/goals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      await reload();
    },
    [reload],
  );

  // Delete a goal. Callers confirm with the human first.
  const remove = useCallback(
    async (id: number) => {
      await fetch(`/api/goals/${id}`, { method: "DELETE" });
      await reload();
    },
    [reload],
  );

  return { goals, conversations, loaded, reload, create, update, remove };
}
