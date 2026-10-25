"use client";

import Link from "next/link";
import { useBuildings, type BuildingKind } from "../../data/useBuildings";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";
import { VILLAGE } from "../manifest";
import { plotLabel } from "./BuildingDialogs";

// The village's signs (#146): the signposts give directions, and the sign on
// an empty plot says what could go there.

// Where clicking a place leads: inside it, or its dialog in the village.
function hrefFor(p: { interior?: string; action?: string; href?: string }) {
  if (p.interior) return `/village/${p.interior}`;
  if (p.action) return `/?open=${p.action}`;
  return p.href ?? "/";
}

export function Directions({ onClose }: { onClose: () => void }) {
  const { villagers } = useVillagers(15000);
  const places = VILLAGE.places.filter((p) => !p.id.startsWith("signpost"));
  const about = villagers.filter((v) => v.life && v.life.place !== "home");
  return (
    <ParchmentDialog kicker="The signpost" title="Directions" onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <ul className="space-y-1">
          {places.map((p) => (
            <li key={p.id} className="flex items-baseline gap-2 rounded border-2 border-[#d8c49a] bg-[#fffaf0] px-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1">
                <strong>{p.label}</strong> <span className="text-[#6b4a2e]">{p.role}</span>
              </span>
              <Link href={hrefFor(p)} onClick={onClose} className="village-btn shrink-0 px-2 py-0.5 text-[11px]">
                Go there
              </Link>
            </li>
          ))}
        </ul>
        <div>
          <p className="village-pixel mb-1 text-xs">Out and about</p>
          {about.length === 0 && <p className="text-xs text-[#6b4a2e]">Everyone&apos;s at home.</p>}
          <ul className="space-y-1 text-xs">
            {about.map((v) => (
              <li key={v.id}>
                <strong>{v.name}</strong>: {v.life!.activity}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ParchmentDialog>
  );
}

const WHAT: Partial<Record<BuildingKind, string>> = {
  house: "beds for two more villagers",
  farm: "wheat for the bakers",
  bakery: "bread for everyone",
  workshop: "crafts to sell to other towns",
  tavern: "evenings together (morale +5)",
  shop: "a shop (morale +3)",
  garden: "flowers (morale +3)",
};

export function PlotSign({ plot, onClose }: { plot: string; onClose: () => void }) {
  const { state } = useBuildings();
  const taken = state?.buildings.find((b) => b.plotId === plot);
  return (
    <ParchmentDialog kicker="A plot of land" title={`🪧 ${plotLabel(plot)}`} onClose={onClose}>
      {!state && <p className="text-sm">Reading the sign…</p>}
      {state && taken && <p className="text-sm">This plot is spoken for: a {state.kinds[taken.kind as BuildingKind]?.label.toLowerCase() ?? taken.kind} is {taken.status === "proposed" ? "proposed" : "going up"}.</p>}
      {state && !taken && (
        <>
          <p className="mb-2 text-sm">Free. What could go here:</p>
          <ul className="mb-3 space-y-0.5 text-xs">
            {(Object.keys(state.kinds) as BuildingKind[]).map((k) => (
              <li key={k}>
                <strong>{state.kinds[k].label}</strong> · {WHAT[k] ?? ""} · 🪙 {state.kinds[k].cost} if the Mayor builds it
              </li>
            ))}
          </ul>
          <p className="mb-3 text-xs text-[#6b4a2e]">The treasury has 🪙 {state.economy.treasury ?? 0}. What you build yourself is free.</p>
        </>
      )}
      <Link href="/village/home?open=home.map" className="village-btn village-btn-go inline-block px-3 py-1.5 text-xs">
        🗺️ Open the map table
      </Link>
    </ParchmentDialog>
  );
}
