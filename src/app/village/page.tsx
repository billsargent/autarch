import { redirect } from "next/navigation";

// The village is Home now; keep old links working.
export default function VillagePage() {
  redirect("/");
}
