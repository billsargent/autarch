import type { VillagerLife } from "@/lib/agent/clientTypes";

// A villager's life at a glance (#137): their trade and level, what they're
// doing, how they feel, their coins and their friends. Under the talk
// drawer's header.

function Need({ label, icon, value }: { label: string; icon: string; value: number }) {
  const tone = value >= 60 ? "#3f6b22" : value >= 30 ? "#a8742a" : "#b3261e";
  return (
    <span className="flex items-center gap-1" title={`${label}: ${value}/100`}>
      <span aria-hidden>{icon}</span>
      <span className="sr-only">{label}</span>
      <span className="block h-1.5 w-10 overflow-hidden rounded bg-[#e6d6b0]" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <span className="block h-full" style={{ width: `${value}%`, background: tone }} />
      </span>
    </span>
  );
}

const FRIEND_ICON: Record<string, string> = { friend: "🤝", "close friend": "💛", sweetheart: "💕", partner: "💍" };

export default function VillagerCard({ life }: { life: VillagerLife }) {
  return (
    <div className="space-y-1 border-b-2 border-[#d8c49a] bg-[#fffaf0] px-4 py-2 text-[11px]">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold">
          {life.icon} {life.title} · level {life.level}
        </span>
        <span className="text-[#6b4a2e]">{life.activity}</span>
        <span className="ml-auto" title="Coins (the village's own; not real money)">
          🪙 {life.coins}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Need label="Energy" icon="⚡" value={life.energy} />
        <Need label="Fullness" icon="🍞" value={life.fullness} />
        <Need label="Company" icon="💬" value={life.company} />
        {life.friends.length > 0 && (
          <span className="text-[#6b4a2e]">
            {life.friends.slice(0, 3).map((f, i) => (
              <span key={f.id}>
                {i > 0 && ", "}
                {FRIEND_ICON[f.status] ?? ""} {f.name}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
