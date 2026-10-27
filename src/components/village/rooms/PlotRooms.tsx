"use client";

import { useEffect, useState } from "react";
import { useBuildings, type BuildingKind } from "../../data/useBuildings";
import { useVillagers } from "../../data/useVillagers";
import { SHOP, SHOP_KEYS } from "@/lib/agent/shop";
import { GOOD_ICON, GOOD_LABEL, TRADES, type Good, type TradeKey } from "@/lib/agent/trades";
import type { AgentRow } from "@/lib/agent/clientTypes";
import ParchmentDialog from "../ParchmentDialog";
import { BuildingDialog } from "./BuildingDialogs";
import type { RoomProps } from "./types";

// Inside the buildings on the plots (#154): the tavern's bar, the bakery's
// oven, the shop's counter, and who keeps each.

const tradeOf = (v: AgentRow) => (v.life?.trade ?? v.trade ?? "helper") as TradeKey;

// The villagers whose trade works this kind of building, and what they're doing.
function Workers({ kind, villagers, none }: { kind: BuildingKind; villagers: AgentRow[]; none: string }) {
  const workers = villagers.filter((v) => TRADES[tradeOf(v)]?.building === kind);
  if (!workers.length) return <p className="text-xs text-[#6b4a2e]">{none}</p>;
  return (
    <ul className="space-y-0.5 text-xs">
      {workers.map((v) => (
        <li key={v.id}>
          <strong>{v.name}</strong>
          {v.life ? ` (${v.life.title.toLowerCase()}): ${v.life.activity}.` : "."}
        </li>
      ))}
    </ul>
  );
}

function Stock({ goods }: { goods: Good[] }) {
  const { state } = useBuildings();
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 rounded border-2 border-[#d8c49a] p-2 text-xs">
      {goods.map((g) => (
        <span key={g}>
          {GOOD_ICON[g]} <strong>{state?.economy[g] ?? "…"}</strong> {GOOD_LABEL[g]}
        </span>
      ))}
    </p>
  );
}

// The keeper's dialog for the building of this kind that stands in the village.
function Keeper({ kind, label, onClose }: { kind: BuildingKind; label: string; onClose: () => void }) {
  const { state } = useBuildings();
  const b = state?.buildings.find((x) => x.kind === kind && x.status === "built");
  if (b) return <BuildingDialog id={b.id} onClose={onClose} />;
  return (
    <ParchmentDialog kicker="The village" title={label} onClose={onClose}>
      <p className="text-sm">{state ? `There's no ${label.toLowerCase()} standing in the village yet.` : "Looking around…"}</p>
    </ParchmentDialog>
  );
}

export function TavernRoom({ action, onClose }: RoomProps) {
  const { villagers } = useVillagers(10000);
  if (action === "tavern.keeper") return <Keeper kind="tavern" label="Tavern" onClose={onClose} />;
  const inTonight = villagers.filter((v) => v.life?.place === "tavern");
  return (
    <ParchmentDialog kicker="The tavern" title="🍺 The bar" onClose={onClose}>
      <p className="mb-2 text-xs text-[#6b4a2e]">
        The innkeeper brews ale from the village&apos;s wheat in working hours. Of an evening (17:00–22:00 on the village clock)
        villagers drop in; a supper here costs 2 coins.
      </p>
      <Stock goods={["ale", "wheat"]} />
      <p className="mt-3 text-xs font-semibold">Behind the bar</p>
      <Workers kind="tavern" villagers={villagers} none="Nobody keeps the tavern. The Mayor can hire an innkeeper." />
      <p className="mt-3 text-xs font-semibold">In tonight</p>
      <p className="text-xs">{inTonight.length ? inTonight.map((v) => v.name).join(", ") : "Nobody, just now."}</p>
    </ParchmentDialog>
  );
}

export function BakeryRoom({ action, onClose }: RoomProps) {
  const { villagers } = useVillagers(10000);
  if (action === "bakery.keeper") return <Keeper kind="bakery" label="Bakery" onClose={onClose} />;
  return (
    <ParchmentDialog kicker="The bakery" title="🍞 The oven" onClose={onClose}>
      <p className="mb-2 text-xs text-[#6b4a2e]">
        In working hours the baker bakes the village&apos;s wheat into loaves, a few at a time, as long as there&apos;s wheat in the
        stores. Everyone eats the loaves first, then fish.
      </p>
      <Stock goods={["bread", "wheat", "fish"]} />
      <p className="mt-3 text-xs font-semibold">At the oven</p>
      <Workers kind="bakery" villagers={villagers} none="Nobody bakes here. The Mayor can hire a baker." />
      <p className="mt-3 text-xs font-semibold">Bringing in the wheat</p>
      <Workers kind="farm" villagers={villagers} none="Nobody farms, so no wheat is coming in." />
    </ParchmentDialog>
  );
}

interface Bought {
  id: number;
  text: string;
  at: number;
}

export function ShopRoom({ action, onClose }: RoomProps) {
  const { villagers } = useVillagers(10000);
  const [bought, setBought] = useState<Bought[] | null>(null);
  useEffect(() => {
    if (action !== "shop.counter") return;
    let live = true;
    fetch("/api/life/chronicle", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { events?: Array<Bought & { kind: string }> }) => {
        if (live) setBought((d.events ?? []).filter((e) => e.kind === "buy").slice(0, 8));
      })
      .catch(() => live && setBought([]));
    return () => {
      live = false;
    };
  }, [action]);
  if (action === "shop.keeper") return <Keeper kind="shop" label="Shop" onClose={onClose} />;
  return (
    <ParchmentDialog kicker="The shop" title="🛍️ The counter" onClose={onClose} wide>
      <p className="mb-2 text-xs text-[#6b4a2e]">
        Villagers with coins to spare buy things for their cottages here, a treat, or flowers for someone they like.
      </p>
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {SHOP_KEYS.map((k) => (
          <li key={k} className="flex justify-between rounded border border-[#d8c49a] px-2 py-1">
            <span>{SHOP[k].label}</span>
            <span>🪙 {SHOP[k].price}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs font-semibold">Minding the shop</p>
      <Workers kind="shop" villagers={villagers} none="Nobody minds the shop just now." />
      <p className="mt-3 text-xs font-semibold">Bought lately</p>
      {bought == null ? (
        <p className="text-xs">Looking through the book…</p>
      ) : bought.length ? (
        <ul className="space-y-0.5 text-xs">
          {bought.map((b) => (
            <li key={b.id}>
              {b.text} <span className="text-[#6b4a2e]">({new Date(b.at).toLocaleDateString([], { weekday: "short" })})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs">Nothing yet.</p>
      )}
    </ParchmentDialog>
  );
}
