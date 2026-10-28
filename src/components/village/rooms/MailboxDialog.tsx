"use client";

import { useState } from "react";
import type { NotificationRow } from "@/lib/agent/clientTypes";
import { useNotifications } from "../../data/useNotifications";
import ParchmentDialog from "../ParchmentDialog";
import { MapTable } from "./BuildingDialogs";

// The mailbox by the cottages: letters (notifications) the agent sends the
// owner — finished work, problems, things that need a look.

const SEVERITY: Record<NotificationRow["severity"], { icon: string; tone: string; label: string }> = {
  info: { icon: "✉", tone: "#2f5f9a", label: "note" },
  success: { icon: "✅", tone: "#3f6b22", label: "good news" },
  warning: { icon: "⚠", tone: "#c58a1b", label: "warning" },
  critical: { icon: "❗", tone: "#b3261e", label: "urgent" },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MailboxDialog({ onClose }: { onClose: () => void }) {
  const { unread, recent, loaded, markRead, markAllRead } = useNotifications();
  const older = recent.filter((n) => n.read);
  // A letter about a building opens the map table, where it's decided (#199).
  const [mapTable, setMapTable] = useState(false);
  if (mapTable) return <MapTable onClose={() => setMapTable(false)} />;

  return (
    <ParchmentDialog
      kicker="The village"
      title="The mailbox"
      onClose={onClose}
      wide
      footer={
        unread.length > 0 && (
          <button onClick={() => void markAllRead()} className="village-btn ml-auto px-3 py-2 text-xs">
            Mark all as read
          </button>
        )
      }
    >
      {!loaded && <p className="text-sm">Checking the mail…</p>}
      {loaded && unread.length === 0 && (
        <p className="rounded border-2 border-dashed border-[#c9b27a] p-4 text-center text-sm">No new letters.</p>
      )}
      {unread.length > 0 && (
        <ul className="space-y-2">
          {unread.map((n) => (
            <Letter key={n.id} n={n} onRead={() => void markRead(n.id)} onMapTable={() => setMapTable(true)} />
          ))}
        </ul>
      )}
      {older.length > 0 && (
        <section className="mt-4">
          <h3 className="village-pixel mb-1.5 text-xs">Already read</h3>
          <ul className="space-y-2 opacity-80">
            {older.map((n) => (
              <Letter key={n.id} n={n} onUnread={() => void markRead(n.id, false)} />
            ))}
          </ul>
        </section>
      )}
    </ParchmentDialog>
  );
}

function Letter({ n, onRead, onUnread, onMapTable }: { n: NotificationRow; onRead?: () => void; onUnread?: () => void; onMapTable?: () => void }) {
  const sev = SEVERITY[n.severity] ?? SEVERITY.info;
  return (
    <li className="rounded border-2 bg-[#fffaf0] px-3 py-2" style={{ borderColor: n.read ? "#d8c49a" : sev.tone }}>
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold">
          <span aria-hidden className="mr-1">
            {sev.icon}
          </span>
          {n.title}
        </p>
        <span className="text-[11px] font-semibold" style={{ color: sev.tone }}>
          {sev.label}
        </span>
      </div>
      {n.body && <p className="mt-1 whitespace-pre-wrap text-xs text-[#5a3d25]">{n.body}</p>}
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#6b4a2e]">
        <span>
          {when(n.createdAt)} · from {n.source}
        </span>
        {onMapTable && n.kind === "building" && (
          <button onClick={onMapTable} className="village-btn village-btn-go ml-auto px-2 py-0.5">
            Decide at the map table
          </button>
        )}
        {onRead && (
          <button onClick={onRead} className={`village-btn px-2 py-0.5 ${onMapTable && n.kind === "building" ? "" : "ml-auto"}`}>
            Mark read
          </button>
        )}
        {onUnread && (
          <button onClick={onUnread} className="village-btn ml-auto px-2 py-0.5">
            Mark unread
          </button>
        )}
      </div>
    </li>
  );
}
