// A room's in-world UI: the dialogs its furniture opens.
export interface RoomProps {
  // The furniture's action that opened the room UI (e.g. "skills.browse").
  action: string;
  // Whose room it is, for rooms that belong to a villager (their cottage).
  agentId?: number | null;
  onClose: () => void;
}
