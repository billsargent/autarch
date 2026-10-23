import type { ComponentType } from "react";
import GuardTowerRoom from "./GuardTowerRoom";
import LibraryRoom from "./LibraryRoom";
import NoticeBoardRoom from "./NoticeBoardRoom";
import ObservatoryRoom from "./ObservatoryRoom";
import TownHallRoom from "./TownHallRoom";
import VaultRoom from "./VaultRoom";
import WorkshopRoom from "./WorkshopRoom";
import type { RoomProps } from "./types";

// The UI for each scene, by scene id. Its furniture's actions (listed in
// actions.ts) are handled by the component. "village" covers the outdoor
// things in the village itself, like the notice board.
export const ROOMS: Record<string, ComponentType<RoomProps>> = {
  village: NoticeBoardRoom,
  library: LibraryRoom,
  workshop: WorkshopRoom,
  guardtower: GuardTowerRoom,
  observatory: ObservatoryRoom,
  vault: VaultRoom,
  townhall: TownHallRoom,
};
