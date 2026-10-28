import type { ComponentType } from "react";
import CottageRoom from "./CottageRoom";
import GuardTowerRoom from "./GuardTowerRoom";
import HomeRoom from "./HomeRoom";
import LibraryRoom from "./LibraryRoom";
import ObservatoryRoom from "./ObservatoryRoom";
import TownHallRoom from "./TownHallRoom";
import VillageOutdoors from "./VillageOutdoors";
import VaultRoom from "./VaultRoom";
import WorkshopRoom from "./WorkshopRoom";
import StorehouseRoom from "./StorehouseRoom";
import PostOfficeRoom from "./PostOfficeRoom";
import { BakeryRoom, ShopRoom, TavernRoom } from "./PlotRooms";
import RiversideRoom from "./RiversideRoom";
import type { RoomProps } from "./types";

// The UI for each scene, by scene id. Its furniture's actions (listed in
// actions.ts) are handled by the component. "village" covers the outdoor
// things in the village itself: the notice board and the mailbox.
export const ROOMS: Record<string, ComponentType<RoomProps>> = {
  village: VillageOutdoors,
  library: LibraryRoom,
  workshop: WorkshopRoom,
  guardtower: GuardTowerRoom,
  observatory: ObservatoryRoom,
  vault: VaultRoom,
  townhall: TownHallRoom,
  cottage: CottageRoom,
  home: HomeRoom,
  storehouse: StorehouseRoom,
  postoffice: PostOfficeRoom,
  tavern: TavernRoom,
  bakery: BakeryRoom,
  shop: ShopRoom,
  riverside: RiversideRoom,
};
