import { NextResponse } from "next/server";
import { BuildingError, approveBuilding, declineBuilding, setKeeper } from "@/lib/agent/buildings";

type Params = { params: Promise<{ id: string }> };

// The owner approves or declines the Mayor's proposal, or picks a keeper.
export async function PATCH(req: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "approve") await approveBuilding(id);
    else if (body.action === "decline") await declineBuilding(id);
    else if (body.action === "keeper") await setKeeper(id, typeof body.agentId === "number" ? body.agentId : null);
    else return NextResponse.json({ error: "action: must be approve, decline or keeper." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BuildingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
