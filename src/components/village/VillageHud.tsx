"use client";

import { signOut } from "@/lib/signOut";
import type { DayPhase } from "@/lib/agent/daynight";

const PHASE_ICON: Record<DayPhase, string> = { dawn: "🌅", day: "☀", dusk: "🌇", night: "🌙" };

interface VillageHudProps {
  villagers: number;
  working: number;
  waiting: number;
  openGoals: number;
  spentToday: number;
  spendCeilingUsd: number | null;
  unread: number;
  paused: boolean;
  // The village clock (#100).
  time: string;
  phase: DayPhase;
  onShowApprovals: () => void;
  onTogglePause: () => void;
  onShowMail: () => void;
  // Town meetings (#81): one going on now, and the way to the long table.
  meetingOn: boolean;
  onMeeting: () => void;
  // Music and little sounds, off unless switched on.
  soundOn: boolean;
  onToggleSound: () => void;
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

// Top bar of the village: the vital signs at a glance, pause, meetings and
// sign-out.
export default function VillageHud(p: VillageHudProps) {
  return (
    <div className="village-hud relative z-20 flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
      <div className="flex shrink-0 gap-2 overflow-x-auto">
        <Chip label="Villagers" value={String(p.villagers)} dot="#5f8a3c" />
        <Chip label="Working" value={String(p.working)} dot="#e3b04b" />
        <Chip label="Open goals" value={String(p.openGoals)} dot="#4f86c6" />
        <Chip
          label={p.spendCeilingUsd != null ? "Spent / ceiling" : "Spent today"}
          value={`$${p.spentToday.toFixed(2)}${p.spendCeilingUsd != null ? ` / $${p.spendCeilingUsd.toFixed(2)}` : ""}`}
          dot="#d9643a"
        />
        <Chip label={p.phase} value={`${PHASE_ICON[p.phase]} ${p.time}`} dot={p.phase === "night" ? "#1d2340" : "#e3b04b"} />
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
          title={p.paused ? "Let everyone work again" : "Freeze every villager's actions and scheduled jobs, at any hour"}
        >
          {p.paused ? "▶ Resume everyone" : "❄ Pause everyone"}
        </button>
        <button onClick={p.onToggleSound} aria-pressed={p.soundOn} className="village-btn px-2.5 py-1.5 text-xs" title={p.soundOn ? "Sound on: click to mute" : "Sound off: click for music and little sounds"}>
          {p.soundOn ? "🔊" : "🔇"}
        </button>
        <button onClick={p.onMeeting} className={`village-btn px-3 py-1.5 text-xs ${p.meetingOn ? "village-btn-go" : ""}`} title="The long table in the town hall">
          {p.meetingOn ? "🏛 Meeting on" : "Call meeting"}
        </button>

        <button onClick={signOut} className="village-btn px-3 py-1.5 text-xs" title="Sign out of the dashboard">
          Sign out
        </button>
      </div>
    </div>
  );
}
