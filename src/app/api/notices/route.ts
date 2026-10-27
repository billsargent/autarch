import { NextResponse } from "next/server";
import { listNotices, removeNotice } from "@/lib/agent/notices";

export const dynamic = "force-dynamic";

// Notices on the village board (#147).
export async function GET() {
  return NextResponse.json({ notices: listNotices() });
}

// The owner takes one down: /api/notices?id=3
export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id: which notice." }, { status: 400 });
  return removeNotice(id) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "No such notice." }, { status: 404 });
}
