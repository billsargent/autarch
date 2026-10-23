"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotificationRow } from "@/lib/agent/clientTypes";

// Notifications the agent sends the owner. Used by the village's mailbox.

export function useNotifications() {
  const [unread, setUnread] = useState<NotificationRow[]>([]);
  const [recent, setRecent] = useState<NotificationRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/notifications").then((r) => r.json());
    setUnread(res.unread || []);
    setRecent(res.recent || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    const id = setInterval(reload, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload]);

  const markRead = useCallback(
    async (id: number, read = true) => {
      await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read }),
      });
      await reload();
    },
    [reload],
  );

  const markAllRead = useCallback(async () => {
    await fetch("/api/notifications", { method: "POST" });
    await reload();
  }, [reload]);

  return { unread, recent, loaded, reload, markRead, markAllRead };
}
