"use client";

import { useCallback, useEffect, useState } from "react";
import ParchmentDialog from "../ParchmentDialog";
import { GOODS, GOOD_ICON, GOOD_LABEL, type Good } from "@/lib/agent/trades";

// The trading post at the market stall (#136): orders from the neighbouring
// towns, what the village has in its stores, its treasury and its good name.
// The Mayor or a trader takes orders on; so can you.

interface Order {
  id: number;
  town: string;
  good: Good;
  qty: number;
  reward: number;
  status: "open" | "accepted" | "delivered" | "expired";
  dueAt: number;
}
type Stores = Record<Good, number> & { treasury: number; reputation: number };

const STATUS: Record<Order["status"], string> = { open: "Open", accepted: "🛒 Taken on", delivered: "✅ Delivered", expired: "⌛ Lapsed" };

export default function TradingPost({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ orders: Order[]; economy: Stores } | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const accept = async (id: number) => {
    const res = await fetch("/api/life/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    setError(res.ok ? null : ((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`));
    await load();
  };
  const due = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return (
    <ParchmentDialog kicker="The market" title="🐴 The trading post" onClose={onClose} wide>
      {!data && <p className="text-sm">Opening the ledger…</p>}
      {data && (
        <>
          <p className="mb-3 text-xs text-[#6b4a2e]">
            The neighbouring towns send orders for the village&apos;s goods. Once an order is taken on, the cart goes as soon as the stores have enough, and the
            treasury is paid. Filled orders raise the village&apos;s good name (and the size of the orders); a missed one lowers it. The treasury pays for the
            Mayor&apos;s new buildings.
          </p>
          <div className="mb-3 flex flex-wrap gap-2 rounded border-2 border-[#d8c49a] p-2 text-xs">
            {GOODS.map((g) => (
              <span key={g}>
                {GOOD_ICON[g]} <strong>{data.economy[g]}</strong> {GOOD_LABEL[g]}
              </span>
            ))}
            <span className="ml-auto">
              🪙 <strong>{data.economy.treasury}</strong> in the treasury · ⭐ good name {data.economy.reputation}
            </span>
          </div>
          {data.orders.length === 0 && <p className="rounded border-2 border-dashed border-[#c9b27a] p-4 text-center text-sm">No orders yet. The first arrives in the morning.</p>}
          <ul className="space-y-1.5">
            {data.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 rounded border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2 text-xs">
                <span className="font-semibold">{o.town}</span>
                <span>
                  {GOOD_ICON[o.good]} {o.qty} {GOOD_LABEL[o.good]} for 🪙 {o.reward}
                </span>
                <span className="text-[#6b4a2e]">{o.status === "open" || o.status === "accepted" ? `by ${due(o.dueAt)}` : ""}</span>
                <span className="ml-auto font-semibold">{STATUS[o.status]}</span>
                {o.status === "open" && (
                  <button onClick={() => void accept(o.id)} className="village-btn village-btn-go px-2 py-1 text-[11px]">
                    Take it on
                  </button>
                )}
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="mt-2 text-xs text-[#b3261e]">
              {error}
            </p>
          )}
        </>
      )}
    </ParchmentDialog>
  );
}
