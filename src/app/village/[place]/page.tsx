import { notFound } from "next/navigation";
import InteriorView from "@/components/village/InteriorView";
import { interiorManifest } from "@/components/village/manifest";

// /village/<room>, optionally ?open=<action> to start with that furniture's
// dialog open (e.g. /village/cottage?open=chat.open), and ?agent=<id> for a
// villager's own room (their cottage).
export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ place: string }>;
  searchParams: Promise<{ open?: string; agent?: string }>;
}) {
  const { place } = await params;
  const scene = interiorManifest(place);
  if (!scene) notFound();
  const { open, agent } = await searchParams;
  const startAction = scene.places.some((p) => p.action === open) ? open : undefined;
  return <InteriorView sceneId={place} startAction={startAction} agentId={Number(agent) || null} />;
}
