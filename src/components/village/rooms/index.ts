import type { ComponentType } from "react";
import LibraryRoom from "./LibraryRoom";
import type { RoomProps } from "./types";

// The UI for each room, by scene id. A room's furniture actions are handled
// by its component.
export const ROOMS: Record<string, ComponentType<RoomProps>> = {
  library: LibraryRoom,
};
