"use client";

import Link from "next/link";
import { signOut } from "@/lib/signOut";

interface VillageHudProps {
  villagers: number;
  working: number;
  waiting: number;
  openGoals: number;
  spentToday: number;
  unread: number;
  paused: boolean;
  onShowApprovals: () => void;
  onTogglePause: () => void;
  onShowMail: () => void;
}

function Chip({ label, value, dot }: { label: string; value: string; dot: string }) {
  return (
    <div className="village-chip flex shrink-0 items-center gap-2 px-3 py-1.5">
      <span className="h-2.5 w-2.5 rounded-full border border-[#3b2716]" style={{ background: dot }} />
      <div className="leading-none">
        <p className="text-[9px] uppercase tracking-wider text-[#e9d6ae]">{label}</p>
        <p className="village-pixel mt-0.5 text-sm text-[#fff6e0]">{value}</p>
      </div>
    </div>
  );
}

// Top bar of the village: the vital signs at a glance, plus the way out to the
// Command Center.
export default function VillageHud(p: VillageHudProps) {
  return (
    <div className="village-hud relative z-20 flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
      <div className="flex shrink-0 gap-2 overflow-x-auto">
        <Chip label="Villagers" value={String(p.villagers)} dot="#5f8a3c" />
        <Chip label="Working" value={String(p.working)} dot="#e3b04b" />
        <Chip label="Open goals" value={String(p.openGoals)} dot="#4f86c6" />
        <Chip label="Spent today" value={`$${p.spentToday.toFixed(2)}`} dot="#d9643a" />
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:ml-auto sm:pb-0">
        {p.waiting > 0 && (
          <button onClick={p.onShowApprovals} className="village-btn village-btn-danger animate-pulse px-3 py-1.5 text-xs motion-reduce:animate-none">
            ❗ {p.waiting} waiting on you
          </button>
        )}
        <button onClick={p.onShowMail} className="village-btn px-3 py-1.5 text-xs" title="The mailbox: notifications" aria-label={`Mailbox, ${p.unread} unread`}>
          ✉ {p.unread}
        </button>
        <button
          onClick={p.onTogglePause}
          className="village-btn px-3 py-1.5 text-xs"
          title={p.paused ? "Resume the agents" : "Pause every agent action and scheduled job"}
        >
          {p.paused ? "☀ Wake up" : "🌙 Lights out"}
        </button>
        <button disabled className="village-btn px-3 py-1.5 text-xs" title="Coming with meetings (#81)">
          Call meeting
        </button>
        <Link href="/chat" className="village-btn village-btn-primary px-3 py-1.5 text-xs" title="The classic pages">
          Command Center
        </Link>
        <button onClick={signOut} className="village-btn px-3 py-1.5 text-xs" title="Sign out of the dashboard">
          Sign out
        </button>
      </div>
    </div>
  );
}
