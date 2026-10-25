"use client";

import { BuildingDialog } from "./BuildingDialogs";
import MailboxDialog from "./MailboxDialog";
import NoticeBoardRoom from "./NoticeBoardRoom";
import TradingPost from "./TradingPost";
import type { RoomProps } from "./types";

// The things you click outdoors in the village: the notice board (goals),
// the mailbox (notifications) and the trading post (#136).
export default function VillageOutdoors({ action, onClose }: RoomProps) {
  if (action === "mail.open") return <MailboxDialog onClose={onClose} />;
  if (action === "trade.post") return <TradingPost onClose={onClose} />;
  // A building on one of the plots (#105): "building.<id>".
  if (action.startsWith("building.")) return <BuildingDialog id={Number(action.slice(9))} onClose={onClose} />;
  return <NoticeBoardRoom action={action} onClose={onClose} />;
}
