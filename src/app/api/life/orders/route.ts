import { NextResponse } from "next/server";
import { sqlite } from "@/db";
import { OrderError, acceptOrder, listOrders } from "@/lib/agent/orders";

export const dynamic = "force-dynamic";

// The trading post (#136): orders from the neighbouring towns, the village's
// stores, its treasury and its good name.
export async function GET() {
  const eco = sqlite.prepare("SELECT wheat, bread, fish, flowers, crafts, ale, treasury, reputation FROM economy WHERE id = 1").get();
  return NextResponse.json({ orders: listOrders(30), economy: eco });
}

// The owner takes on an order themselves.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: "id: which order." }, { status: 400 });
  try {
    return NextResponse.json({ order: acceptOrder(id, null) });
  } catch (err) {
    if (err instanceof OrderError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
