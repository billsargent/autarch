// The guard tower: the town watch keeps the logbook — every tool call the
// agent has tried — and chalks today's numbers on the tally board.
import { interior } from "./shell";

export const GUARDTOWER_SCENE = interior({
  id: "guardtower",
  title: "The guard tower",
  floor: "cobbleFloor",
  ground: [
    { stamp: "windowBlue", col: 3, row: 0 },
    { stamp: "windowRed", col: 11, row: 0 },
    { stamp: "redBanner", col: 7, row: 1 },
  ],
  places: [
    {
      id: "logbook",
      label: "Logbook",
      role: "Every tool call the agent has tried — filter it and open any entry",
      door: "desk",
      action: "activity.log",
      parts: [{ stamp: "writingDesk", col: 3, row: 5 }],
    },
    {
      id: "tally",
      label: "Tally board",
      role: "Today's sessions, actions, tokens and cost",
      door: "tally",
      action: "activity.today",
      parts: [{ stamp: "svNoticeBoard", col: 11, row: 3 }],
    },
  ],
  decor: [
    { stamp: "bannerPost", col: 1, row: 3 },
    { stamp: "lanternPost", col: 14, row: 3 },
    { stamp: "logBench", col: 6, row: 3 },
    { stamp: "darkDresser", col: 1, row: 6 },
    { stamp: "bigBarrel", col: 12, row: 7 },
    { stamp: "crateSmall", col: 14, row: 7 },
  ],
  waypoints: [
    { id: "desk", x: 4, y: 7.6 },
    { id: "tally", x: 11.5, y: 5.6 },
  ],
  edges: [
    ["center", "desk"],
    ["center", "tally"],
  ],
});
