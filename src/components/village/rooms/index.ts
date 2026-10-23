import type { ComponentType } from "react";
import LibraryRoom from "./LibraryRoom";
import NoticeBoardRoom from "./NoticeBoardRoom";
import WorkshopRoom from "./WorkshopRoom";
import type { RoomProps } from "./types";

// The UI for each scene, by scene id. Its furniture's actions (listed in
// actions.ts) are handled by the component. "village" covers the outdoor
// things in the village itself, like the notice board.
export const ROOMS: Record<string, ComponentType<RoomProps>> = {
  village: NoticeBoardRoom,
  library: LibraryRoom,
  workshop: WorkshopRoom,
};
