"use client";

import { useCallback, useEffect, useState } from "react";
import ParchmentDialog from "../ParchmentDialog";
import { Pantry } from "./BuildingDialogs";
import TradingPost from "./TradingPost";
import type { RoomProps } from "./types";

// The storehouse (#145): the village stores, the cart (orders from other
// towns) and the storekeeper's ledger.
export default function StorehouseRoom({ action, onClose }: RoomProps) {
  if (action === "store.orders") return <TradingPost onClose={onClose} />;
  if (action === "store.ledger") return <Ledger onClose={onClose} />;
  return <Pantry onClose={onClose} kicker="The storehouse" />;
}

interface LifeEvent {
  id: number;
  kind: string;
  text: string;
  at: number;
}

// What came in and went out: orders, deliveries and purchases, newest first.
function Ledger({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<LifeEvent[] | null>(null);
  const [eco, setEco] = useState<{ treasury: number; reputation: number } | null>(null);
  const load = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([
        fetch("/api/life/chronicle", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/life/orders", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setEvents((c.events as LifeEvent[]).filter((e) => e.kind === "order" || e.kind === "buy" || e.kind === "gift"));
      setEco(o.economy);
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <ParchmentDialog kicker="The storehouse" title="The storekeeper's ledger" onClose={onClose} wide>
      {eco && (
        <p className="mb-3 rounded border-2 border-[#d8c49a] p-2 text-xs">
          🪙 <strong>{eco.treasury}</strong> in the treasury · ⭐ good name {eco.reputation}. The treasury pays for the Mayor&apos;s new
          buildings; orders from other towns fill it.
        </p>
      )}
      {!events && <p className="text-sm">Turning the pages…</p>}
      {events?.length === 0 && <p className="text-sm">Nothing written yet.</p>}
      <ul className="space-y-1 text-sm">
        {events?.map((e) => (
          <li key={e.id}>
            <span className="text-xs text-[#6b4a2e]">{new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>{" "}
            {e.text}
          </li>
        ))}
      </ul>
    </ParchmentDialog>
  );
}
