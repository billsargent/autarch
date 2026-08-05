"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NotificationRow } from "@/lib/agent/clientTypes";

const NAV = [
  { href: "/", label: "Chat", icon: "💬" },
  { href: "/journal", label: "Journal", icon: "📓" },
  { href: "/jobs", label: "Jobs", icon: "🗓️" },
  { href: "/goals", label: "Goals", icon: "🎯" },
  { href: "/approvals", label: "Approvals", icon: "🛑" },
  { href: "/activity", label: "Activity Log", icon: "📜" },
  { href: "/monitor", label: "System Monitor", icon: "🖥️" },
  { href: "/settings", label: "Settings & Safeguards", icon: "⚙️" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const [deepSeekConfigured, setDeepSeekConfigured] = useState<boolean | null>(null);
  const [unread, setUnread] = useState(0);
  const [paused, setPaused] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationRow[]>([]);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const [approvalsRes, settingsRes, notifRes] = await Promise.all([
          fetch("/api/approvals").then((r) => r.json()),
          fetch("/api/settings").then((r) => r.json()),
          fetch("/api/notifications").then((r) => r.json()),
        ]);
        if (!alive) return;
        setPendingCount(approvalsRes.pending?.length || 0);
        setDeepSeekConfigured(Boolean(settingsRes.deepSeekConfigured));
        setPaused(Boolean(settingsRes.settings?.paused));
        setUnread(notifRes.unread?.length || 0);
        if (bellOpen) setNotifs(notifRes.unread || []);
      } catch {
        /* ignore */
      }
    }
    poll();
    const id = setInterval(poll, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [bellOpen]);

  async function togglePause() {
    const res = await fetch("/api/settings").then((r) => r.json());
    const next = !res.settings?.paused;
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: next }),
    });
    setPaused(next);
  }

  async function markAllRead() {
    await fetch("/api/notifications", { method: "POST" });
    setNotifs([]);
    setUnread(0);
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <aside className="relative flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950/95">
        <div className="border-b border-neutral-800 px-5 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-700 font-mono text-sm font-bold">
              R1
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Autarch</p>
              <p className="text-[11px] leading-tight text-neutral-500">autonomous agent control</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                deepSeekConfigured === null ? "bg-neutral-600" : deepSeekConfigured ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
            <span className="text-neutral-500">
              {deepSeekConfigured === null ? "checking API key…" : deepSeekConfigured ? "DeepSeek API connected" : "API key missing"}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={togglePause}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                paused
                  ? "border-emerald-700 bg-emerald-900/40 text-emerald-300"
                  : "border-red-700 bg-red-900/30 text-red-300"
              }`}
              title="Freeze / resume all agent actions and scheduled jobs"
            >
              {paused ? "▶ Resume" : "⏸ Pause"}
            </button>
            <button
              onClick={() => setBellOpen((o) => !o)}
              className="relative ml-auto flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-300"
              title="Notifications"
            >
              🔔
              {unread > 0 && (
                <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold text-white">{unread}</span>
              )}
            </button>
          </div>
          {bellOpen && (
            <div className="absolute right-3 top-36 z-50 w-80 rounded-xl border border-neutral-700 bg-neutral-900 p-2 shadow-2xl">
              <div className="flex items-center justify-between px-2 py-1">
                <p className="text-xs font-semibold">Notifications</p>
                {notifs.length > 0 && (
                  <button onClick={markAllRead} className="text-[10px] text-blue-400 hover:text-blue-300">
                    mark all read
                  </button>
                )}
              </div>
              {notifs.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-neutral-500">No unread notifications.</p>
              ) : (
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {notifs.map((n) => (
                    <div key={n.id} className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                      <p className="text-[11px] font-semibold text-neutral-200">
                        <span className="mr-1 text-[10px] uppercase text-neutral-500">[{n.severity}]</span>
                        {n.title}
                      </p>
                      {n.body && <p className="mt-0.5 whitespace-pre-wrap text-[10px] text-neutral-400">{n.body}</p>}
                      <p className="mt-1 text-[9px] text-neutral-600">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                  active ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{item.icon}</span>
                  {item.label}
                </span>
                {item.href === "/approvals" && pendingCount > 0 && (
                  <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-neutral-800 p-4 text-[11px] text-neutral-600">
          <p>Experimental. The agent runs with real shell/file/system access inside guardrails you configure.</p>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
