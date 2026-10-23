import { notFound } from "next/navigation";
import InteriorView from "@/components/village/InteriorView";
import { interiorManifest } from "@/components/village/manifest";

export default async function RoomPage({ params }: { params: Promise<{ place: string }> }) {
  const { place } = await params;
  if (!interiorManifest(place)) notFound();
  return <InteriorView sceneId={place} />;
}
