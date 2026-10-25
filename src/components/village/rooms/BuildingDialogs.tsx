"use client";

import { useState } from "react";
import { useBuildings, type BuildingKind, type BuildingRow, type BuildingsState } from "../../data/useBuildings";
import { GOODS, GOOD_ICON, GOOD_LABEL } from "@/lib/agent/trades";
import { useVillagers } from "../../data/useVillagers";
import ParchmentDialog from "../ParchmentDialog";

// The village's new buildings (#105) and its stores (#106): a building's own
// dialog (who keeps it, what it makes), the map table at home (plots,
// proposals, building), and the pantry.

const WHAT: Record<BuildingKind, string> = {
  house: "Beds for two more villagers.",
  farm: "Grows wheat: 6 a day with a keeper, 2 without.",
  bakery: "Bakes the wheat into bread: up to 6 loaves a day with a keeper, 2 without.",
  workshop: "Somewhere for the village to make things.",
  tavern: "Somewhere to unwind after work: everyone's morale +5. Idle villagers drop in.",
  shop: "A little shop on the road: everyone's morale +3.",
  garden: "Flower beds and gravel paths: everyone's morale +3.",
};
const ICON: Record<BuildingKind, string> = { house: "🏠", farm: "🌾", bakery: "🍞", workshop: "🔧", tavern: "🍺", shop: "🛍️", garden: "🌷" };
// "north-3" → "North road, left (second ring)": two plots per road per ring.
const RING = ["first", "second", "third", "fourth"];
export function plotLabel(plot: string) {
  const m = /^(north|west)-(\d+)$/.exec(plot);
  if (!m) return plot;
  const n = Number(m[2]) - 1;
  const side = m[1] === "north" ? (n % 2 ? "right" : "left") : n % 2 ? "lower" : "upper";
  const ring = Math.floor(n / 2);
  return `${m[1] === "north" ? "North" : "West"} road, ${side}${ring ? ` (${RING[ring] ?? `ring ${ring + 1}`} ring)` : ""}`;
}
const until = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "soon");

function Stores({ economy }: { economy: BuildingsState["economy"] }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 rounded border-2 border-[#d8c49a] p-2 text-xs">
      {GOODS.map((g) => (
        <span key={g}>
          {GOOD_ICON[g]} <strong>{economy[g] ?? 0}</strong> {GOOD_LABEL[g]}
        </span>
      ))}
      <span>
        🪙 <strong>{economy.treasury ?? 0}</strong> in the treasury
      </span>
      {economy.shortage > 0 && <span className="text-[#b3261e]">someone went hungry today</span>}
    </p>
  );
}

export function BuildingDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { state, setKeeper } = useBuildings();
  const { villagers } = useVillagers(30000);
  const [error, setError] = useState<string | null>(null);
  const b = state?.buildings.find((x) => x.id === id);
  if (!state || !b) {
    return (
      <ParchmentDialog kicker="The village" title="A building" onClose={onClose}>
        <p className="text-sm">{state ? "It's gone." : "Walking over…"}</p>
      </ParchmentDialog>
    );
  }
  if (b.kind === "land") return null;
  const kind = state.kinds[b.kind];
  const keeps = b.kind === "farm" || b.kind === "bakery";
  return (
    <ParchmentDialog kicker="The village" title={`${ICON[b.kind]} ${kind.label}`} onClose={onClose}>
      <p className="mb-2 text-xs text-[#6b4a2e]">{WHAT[b.kind]}</p>
      {b.status === "building" && <p className="mb-2 text-sm">🚧 Still being built: ready {until(b.readyAt)}.</p>}
      {keeps && b.status === "built" && (
        <label className="mb-2 block text-xs font-semibold">
          Kept by
          <select
            name="keeper"
            value={b.keeperId ?? ""}
            onChange={async (e) => {
              const res = await setKeeper(b.id, e.target.value ? Number(e.target.value) : null);
              setError(res.ok ? null : res.error);
            }}
            className="mt-1 block w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 text-sm font-normal"
          >
            <option value="">Nobody</option>
            {villagers.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.isMayor ? "Mayor" : v.role})
              </option>
            ))}
          </select>
          <span className="mt-0.5 block font-normal text-[11px] text-[#6b4a2e]">The keeper spends their spare time here. Looking after it costs nothing.</span>
        </label>
      )}
      {error && <p role="alert" className="text-xs text-[#b3261e]">{error}</p>}
      {(b.kind === "farm" || b.kind === "bakery") && <Stores economy={state.economy} />}
    </ParchmentDialog>
  );
}

export function MapTable({ onClose }: { onClose: () => void }) {
  const { state, build, decide, clearLand } = useBuildings();
  const [kind, setKind] = useState<BuildingKind>("house");
  const [error, setError] = useState<string | null>(null);
  if (!state) {
    return (
      <ParchmentDialog kicker="Your home" title="The map table" onClose={onClose}>
        <p className="text-sm">Unrolling the map…</p>
      </ParchmentDialog>
    );
  }
  const on = (plot: string) => state.buildings.find((b): b is BuildingRow & { kind: BuildingKind } => b.plotId === plot && b.kind !== "land");
  const land = state.buildings.find((b) => b.kind === "land" && b.status !== "built");
  const done = (res: { ok: true } | { ok: false; error: string }) => setError(res.ok ? null : res.error);
  return (
    <ParchmentDialog kicker="Your home" title="The map table" onClose={onClose} wide>
      <p className="mb-3 text-xs text-[#6b4a2e]">
        The land north and west of town, with a plot on each side of the roads. The Mayor proposes buildings and you decide,
        or build something yourself. A building takes half a day. Each house makes room for two more villagers (room now: {state.room}). The
        Mayor&apos;s proposals are paid from the village treasury (🪙 {state.economy.treasury ?? 0} now); what you build yourself is on you.
      </p>
      <div className="mb-3 rounded border-2 border-[#d8c49a] p-2 text-xs">
        <p className="font-semibold">
          🗺️ Land: ring {state.level + 1} of {state.maxLevel + 1}
        </p>
        {land?.status === "proposed" && (
          <div className="mt-1">
            <p>📜 The Mayor would like to clear the next ring of land: four more plots, a day&apos;s work.</p>
            <div className="mt-1 flex gap-1.5">
              <button onClick={async () => done(await decide(land.id, "approve"))} className="village-btn village-btn-go px-2 py-1 text-[11px]">
                ✅ Clear it
              </button>
              <button onClick={async () => done(await decide(land.id, "decline"))} className="village-btn village-btn-danger px-2 py-1 text-[11px]">
                ❌ Not now
              </button>
            </div>
          </div>
        )}
        {land?.status === "building" && <p className="mt-1">🪓 Clearing the next ring: ready {until(land.readyAt)}.</p>}
        {!land &&
          (state.landBlocked ? (
            <p className="mt-1 text-[#6b4a2e]">{state.landBlocked}</p>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[#6b4a2e]">Every plot is spoken for.</span>
              <button onClick={async () => done(await clearLand())} className="village-btn px-2 py-1 text-[11px]">
                Clear the next ring (four more plots)
              </button>
            </div>
          ))}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {state.plots.map((plot) => {
          const b = on(plot);
          return (
            <li key={plot} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2.5 text-xs">
              <p className="font-semibold">{plotLabel(plot)}</p>
              {!b && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[#6b4a2e]">Empty.</span>
                  <button onClick={async () => done(await build(kind, plot))} className="village-btn px-2 py-1 text-[11px]">
                    Build a {state.kinds[kind].label.toLowerCase()} here
                  </button>
                </div>
              )}
              {b?.status === "proposed" && (
                <div className="mt-1">
                  <p>
                    📜 The Mayor would like a <strong>{state.kinds[b.kind].label.toLowerCase()}</strong> here.
                  </p>
                  <div className="mt-1 flex gap-1.5">
                    <button onClick={async () => done(await decide(b.id, "approve"))} className="village-btn village-btn-go px-2 py-1 text-[11px]">
                      ✅ Build it
                    </button>
                    <button onClick={async () => done(await decide(b.id, "decline"))} className="village-btn village-btn-danger px-2 py-1 text-[11px]">
                      ❌ Not now
                    </button>
                  </div>
                </div>
              )}
              {b?.status === "building" && (
                <p className="mt-1">
                  🚧 {state.kinds[b.kind].label}: ready {until(b.readyAt)}.
                </p>
              )}
              {b?.status === "built" && (
                <p className="mt-1">
                  {ICON[b.kind]} {state.kinds[b.kind].label}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <fieldset className="mt-3">
        <legend className="text-xs font-semibold">What to build on an empty plot</legend>
        <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup">
          {(Object.keys(state.kinds) as BuildingKind[]).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`village-btn px-2.5 py-1 text-[11px] ${kind === k ? "village-btn-go" : ""}`}>
              {ICON[k]} {state.kinds[k].label} · 🪙{state.kinds[k].cost}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-[#6b4a2e]">{WHAT[kind]}</p>
      </fieldset>
      {error && <p role="alert" className="mt-2 text-xs text-[#b3261e]">{error}</p>}
    </ParchmentDialog>
  );
}

// The village stores (#106, #145): kept at the storehouse; the pantry at home
// opens the same.
export function Pantry({ onClose, kicker = "Your home" }: { onClose: () => void; kicker?: string }) {
  const { state } = useBuildings();
  const farms = state?.buildings.filter((b) => b.kind === "farm" && b.status === "built").length ?? 0;
  const bakeries = state?.buildings.filter((b) => b.kind === "bakery" && b.status === "built").length ?? 0;
  return (
    <ParchmentDialog kicker={kicker} title="The village stores" onClose={onClose}>
      {!state && <p className="text-sm">Opening the cupboard…</p>}
      {state && (
        <>
          <Stores economy={state.economy} />
          <p className="mt-2 text-xs text-[#6b4a2e]">
            {farms || bakeries
              ? `${farms} farm${farms === 1 ? "" : "s"} and ${bakeries} ${bakeries === 1 ? "bakery" : "bakeries"}. The farmers and bakers fill the stores by working their trade, and villagers eat when they're hungry.`
              : "No farm or bakery yet. Build them on the map table; villagers with that trade will work there."}{" "}
            If someone goes hungry the village gets grumpy, but nobody stops working. Spare goods go to other towns from the trading post.
          </p>
        </>
      )}
    </ParchmentDialog>
  );
}
