import { redirect } from "next/navigation";

// The old Command Center page; its room in the village does everything it did.
export default function Page() {
  redirect("/village/townhall?open=settings.open");
}
