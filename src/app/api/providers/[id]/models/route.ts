import { NextResponse } from "next/server";
import { fetchModels, getProvider } from "@/lib/agent/providers";
import { getSettings } from "@/lib/agent/settingsStore";

type Params = { params: Promise<{ id: string }> };

// The models a provider offers; id 0 is the town's own provider.
export async function GET(_req: Request, { params }: Params) {
  const id = Number((await params).id);
  const p = id ? getProvider(id) : null;
  if (id && !p) return NextResponse.json({ error: "No such provider." }, { status: 404 });
  try {
    return NextResponse.json({ models: await fetchModels(p, await getSettings()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
