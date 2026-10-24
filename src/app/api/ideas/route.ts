import { NextResponse } from "next/server";
import { IdeaError, listIdeas, proposeIdea } from "@/lib/agent/ideas";

export const dynamic = "force-dynamic";

// The ideas on the notice board (#98), with the latest round's votes.
export async function GET() {
  return NextResponse.json({ ideas: await listIdeas() });
}

// The owner pins an idea.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const idea = await proposeIdea(String(body.title ?? ""), typeof body.body === "string" ? body.body : null, null);
    return NextResponse.json({ idea });
  } catch (err) {
    if (err instanceof IdeaError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
