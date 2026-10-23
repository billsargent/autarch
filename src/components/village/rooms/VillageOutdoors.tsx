"use client";

import MailboxDialog from "./MailboxDialog";
import NoticeBoardRoom from "./NoticeBoardRoom";
import type { RoomProps } from "./types";

// The things you click outdoors in the village: the notice board (goals) and
// the mailbox (notifications).
export default function VillageOutdoors({ action, onClose }: RoomProps) {
  if (action === "mail.open") return <MailboxDialog onClose={onClose} />;
  return <NoticeBoardRoom action={action} onClose={onClose} />;
}
