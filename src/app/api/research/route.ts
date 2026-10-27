import { NextResponse } from "next/server";
import { ResearchError, cancel, commission, listProjects } from "@/lib/agent/research";

export const dynamic = "force-dynamic";

// The research desk (#170), for the owner: the projects, and commissioning one.
export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ project: commission(body) });
  } catch (err) {
    if (err instanceof ResearchError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

// { id, action: "cancel" }
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: number; action?: string };
  if (body.action !== "cancel" || !Number.isInteger(body.id)) return NextResponse.json({ error: "action: cancel, with the project's id." }, { status: 400 });
  try {
    cancel(body.id!);
    return GET();
  } catch (err) {
    if (err instanceof ResearchError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
