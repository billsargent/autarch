// The town hall: the clerk's desk holds everything waiting on the owner's
// approval, the records cabinet keeps the recent decisions, and the Mayor's
// ledger holds the settings (the owner's alone). The long table hosts town
// meetings (#81).
import { interior } from "./shell";

export const TOWNHALL_SCENE = interior({
  id: "townhall",
  title: "The town hall",
  ground: [
    { stamp: "windowRed", col: 3, row: 0 },
    { stamp: "windowRed", col: 11, row: 0 },
    { stamp: "redBanner", col: 7, row: 1 },
    { stamp: "bigRug", col: 7, row: 4 },
  ],
  places: [
    {
      id: "clerk",
      label: "Clerk's desk",
      role: "Actions waiting on your approval — see the exact command, then approve or deny",
      door: "clerk",
      action: "approvals.pending",
      parts: [{ stamp: "writingDesk", col: 3, row: 5 }],
    },
    {
      id: "records",
      label: "Records cabinet",
      role: "Recent approval decisions",
      door: "records",
      action: "approvals.records",
      parts: [
        { stamp: "darkDresser", col: 12, row: 2 },
        { stamp: "drawers", col: 14, row: 2 },
      ],
    },
    {
      id: "ledger",
      label: "Mayor's ledger",
      role: "Every setting: pause, overrides, model, prompts, autonomy, limits, tools, protected paths",
      door: "ledger",
      action: "settings.open",
      parts: [{ stamp: "tallBookshelf", col: 1, row: 7 }],
    },
    {
      id: "table",
      label: "The long table",
      role: "Town meetings: call one, ask it something, and everyone answers in turn",
      door: "table",
      action: "meeting.open",
      parts: [
        { stamp: "workbench", col: 7, row: 5 },
        { stamp: "chairRed", col: 6, row: 5 },
        { stamp: "chairBlue", col: 10, row: 5 },
      ],
    },
  ],
  decor: [
    { stamp: "pottedPlant", col: 1, row: 3 },
    { stamp: "pottedPlant", col: 14, row: 7 },
  ],
  waypoints: [
    { id: "clerk", x: 4, y: 7.6 },
    { id: "records", x: 13, y: 4.6 },
    { id: "table", x: 8.5, y: 6.6 },
    { id: "ledger", x: 3.2, y: 9.3 },
  ],
  edges: [
    ["center", "clerk"],
    ["center", "records"],
    ["center", "table"],
    ["center", "ledger"],
  ],
});
