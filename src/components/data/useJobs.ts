"use client";

import { useCallback, useEffect, useState } from "react";
import type { JobRow, WorkSessionRow } from "@/lib/agent/clientTypes";
import { fetchConversationChoices, type ConversationChoice } from "./conversationChoices";

// Jobs: recurring work windows the worker opens for the agent. Shared by the
// Jobs page and the workshop in the village, so both always behave the same.

export interface JobInput {
  name: string;
  instruction: string;
  intervalMinutes: number;
  maxDurationMinutes: number;
  cron: string;
  // "" = auto-create a report session.
  conversationId: string;
  reportSessionTitle: string;
}

export const EMPTY_JOB: JobInput = {
  name: "",
  instruction: "",
  intervalMinutes: 60,
  maxDurationMinutes: 10,
  cron: "",
  conversationId: "",
  reportSessionTitle: "",
};

export function jobInput(job: JobRow): JobInput {
  return {
    name: job.name,
    instruction: job.instruction,
    intervalMinutes: job.intervalMinutes,
    maxDurationMinutes: job.maxDurationMinutes,
    cron: job.cron || "",
    conversationId: job.conversationId ? String(job.conversationId) : "",
    reportSessionTitle: job.reportSessionTitle || "",
  };
}

// "every 60 min", or the cron expression.
export function jobSchedule(job: Pick<JobRow, "cron" | "intervalMinutes">): string {
  return job.cron ? `cron "${job.cron}"` : `every ${job.intervalMinutes} min`;
}

export type JobResult = { ok: true } | { ok: false; error: string };

export function useJobs() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [conversations, setConversations] = useState<ConversationChoice[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/jobs").then((r) => r.json());
    setJobs(res.jobs || []);
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

  // Create a job, or replace the fields of an existing one.
  const save = useCallback(
    async (input: JobInput, id?: number): Promise<JobResult> => {
      if (!input.name.trim()) return { ok: false, error: "A name is required." };
      const payload = {
        name: input.name,
        instruction: input.instruction,
        intervalMinutes: input.intervalMinutes,
        maxDurationMinutes: input.maxDurationMinutes,
        // Always send these so the server can clear them when they're empty.
        cron: input.cron.trim() || null,
        reportSessionTitle: input.reportSessionTitle.trim() || null,
        conversationId: input.conversationId || null,
      };
      try {
        const res = await fetch(id ? `/api/jobs/${id}` : "/api/jobs", {
          method: id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: data.error || `Failed to save job (HTTP ${res.status})` };
        }
      } catch (err) {
        return { ok: false, error: `Failed to save job: ${err instanceof Error ? err.message : String(err)}` };
      }
      await reload();
      return { ok: true };
    },
    [reload],
  );

  const setEnabled = useCallback(
    async (job: JobRow, enabled: boolean) => {
      await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await reload();
    },
    [reload],
  );

  // Delete a job. Callers confirm with the human first.
  const remove = useCallback(
    async (job: JobRow) => {
      await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
      await reload();
    },
    [reload],
  );

  // Open a work window now, outside the schedule.
  const runNow = useCallback(
    async (job: JobRow): Promise<JobResult> => {
      try {
        const res = await fetch(`/api/jobs/${job.id}/runs`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        return res.ok ? { ok: true } : { ok: false, error: data.error || "Failed to start job" };
      } catch (err) {
        return { ok: false, error: `Failed to start job: ${err instanceof Error ? err.message : String(err)}` };
      } finally {
        await reload();
      }
    },
    [reload],
  );

  const loadRuns = useCallback(async (jobId: number): Promise<WorkSessionRow[]> => {
    const res = await fetch(`/api/jobs/${jobId}/runs`).then((r) => r.json());
    return res.runs || [];
  }, []);

  return { jobs, conversations, loaded, reload, save, setEnabled, remove, runNow, loadRuns };
}
