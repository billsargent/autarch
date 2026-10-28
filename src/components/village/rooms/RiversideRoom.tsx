"use client";

import { useCallback, useEffect, useState } from "react";
import { seasonOf, SEASON_NOTE } from "@/lib/agent/seasons";
import { GOOD_ICON, GOOD_LABEL, type Good } from "@/lib/agent/trades";
import { useVillagers } from "../../data/useVillagers";
import { useVillageData } from "../useVillageData";
import ParchmentDialog from "../ParchmentDialog";
import type { RoomProps } from "./types";

// The riverside (#190): the jetty, where the fishers work, and the boat that
// takes the village's goods downriver.

interface Order {
  id: number;
  town: string;
  good: Good;
  qty: number;
  reward: number;
  status: "open" | "accepted" | "delivered" | "expired";
  dueAt: number;
}

function useOrders() {
  const [data, setData] = useState<{ orders: Order[]; economy: Record<string, number> } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await fetch("/api/life/orders", { cache: "no-store" }).then((r) => r.json()));
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  return data;
}

const day = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

export default function RiversideRoom({ action, onClose }: RoomProps) {
  return action === "riverside.boat" ? <Boat onClose={onClose} /> : <Jetty onClose={onClose} />;
}

function Jetty({ onClose }: { onClose: () => void }) {
  const { villagers } = useVillagers(15000);
  const { data } = useVillageData();
  const orders = useOrders();
  const fishers = villagers.filter((v) => v.status !== "dismissed" && (v.life?.trade ?? v.trade) === "fisher");
  const [now] = useState(() => Date.now());
  const season = seasonOf(new Date(now), data.villageClock, data.villageDayHours).season;
  return (
    <ParchmentDialog kicker="The riverside" title="The jetty" onClose={onClose}>
      <p className="mb-2 text-xs text-[#6b4a2e]">
        The village&apos;s fishers work from the jetty. The river is richer than the old pond: now and then a stint brings one more fish. It&apos;s{" "}
        {SEASON_NOTE[season]}.
      </p>
      <p className="text-xs font-semibold">Fishers</p>
      {fishers.length === 0 ? (
        <p className="text-xs text-[#6b4a2e]">Nobody fishes yet. The Mayor can hire a fisher.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs">
          {fishers.map((v) => (
            <li key={v.id} className="rounded border-2 border-[#d8c49a] bg-[#fffaf0] px-2 py-1">
              <strong>{v.name}</strong>
              <span className="text-[#6b4a2e]"> · {v.life?.place === "work" ? "🎣 fishing now" : (v.life?.activity ?? "about the village")}</span>
            </li>
          ))}
        </ul>
      )}
      {orders && (
        <p className="mt-3 text-xs">
          {GOOD_ICON.fish} <strong>{orders.economy.fish ?? 0}</strong> {GOOD_LABEL.fish} in the stores.
        </p>
      )}
    </ParchmentDialog>
  );
}

function Boat({ onClose }: { onClose: () => void }) {
  const orders = useOrders();
  const going = (orders?.orders ?? []).filter((o) => o.status === "accepted");
  const gone = (orders?.orders ?? []).filter((o) => o.status === "delivered").slice(0, 5);
  return (
    <ParchmentDialog kicker="The riverside" title="The boat" onClose={onClose}>
      <p className="mb-2 text-xs text-[#6b4a2e]">
        Goods for the neighbouring towns go downriver by boat once the stores have enough of them. Orders are taken on at the trading post.
      </p>
      {!orders && <p className="text-sm">Checking the cargo…</p>}
      <p className="text-xs font-semibold">Waiting to be loaded</p>
      {orders && going.length === 0 && <p className="text-xs text-[#6b4a2e]">Nothing: no orders taken on.</p>}
      <ul className="mt-1 space-y-1 text-xs">
        {going.map((o) => (
          <li key={o.id} className="rounded border-2 border-[#d8c49a] bg-[#fffaf0] px-2 py-1">
            {GOOD_ICON[o.good]} {o.qty} {GOOD_LABEL[o.good]} for {o.town} · by {day(o.dueAt)} · {o.reward} coins
            <span className="text-[#6b4a2e]"> · {(orders?.economy[o.good] ?? 0) >= o.qty ? "ready to load" : `the stores have ${orders?.economy[o.good] ?? 0}`}</span>
          </li>
        ))}
      </ul>
      {gone.length > 0 && (
        <>
          <p className="mt-3 text-xs font-semibold">Gone downriver lately</p>
          <ul className="mt-1 space-y-0.5 text-xs text-[#6b4a2e]">
            {gone.map((o) => (
              <li key={o.id}>
                {GOOD_ICON[o.good]} {o.qty} {GOOD_LABEL[o.good]} to {o.town} · {o.reward} coins
              </li>
            ))}
          </ul>
        </>
      )}
    </ParchmentDialog>
  );
}
