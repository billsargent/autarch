// The post office (#144): the counter where the villagers' drafts wait for the
// owner, the pigeonholes of everything sent (who wrote it, and why), the
// mailbag (the owner's inbox), the calendar desk, and the letter rack of the
// villagers' letters to each other (#172).
import { interior } from "./shell";

export const POSTOFFICE_SCENE = interior({
  id: "postoffice",
  title: "The post office",
  ground: [
    { stamp: "windowBlue", col: 3, row: 0 },
    { stamp: "windowRed", col: 11, row: 0 },
    { stamp: "redBanner", col: 7, row: 1 },
  ],
  places: [
    {
      id: "counter",
      label: "The counter",
      role: "Drafts waiting for you: who wrote each, why, and to whom",
      door: "counter",
      action: "post.outbox",
      parts: [{ stamp: "workbench", col: 6, row: 4 }],
    },
    {
      id: "pigeonholes",
      label: "Pigeonholes",
      role: "Everything sent: who wrote it, why, to whom and when",
      door: "pigeonholes",
      action: "post.sent",
      parts: [{ stamp: "tallBookshelf", col: 1, row: 2 }],
    },
    {
      id: "mailbag",
      label: "The mailbag",
      role: "Your inbox, and which villagers may read it",
      door: "mailbag",
      action: "post.inbox",
      parts: [{ stamp: "sack", col: 13, row: 4 }],
    },
    {
      id: "calendardesk",
      label: "The calendar desk",
      role: "Your connected calendars",
      door: "calendardesk",
      action: "post.calendar",
      parts: [{ stamp: "writingDesk", col: 12, row: 7 }],
    },
    {
      id: "letterrack",
      label: "The letter rack",
      role: "Letters the villagers write each other (#172)",
      door: "letterrack",
      action: "post.letters",
      parts: [{ stamp: "drawers", col: 4, row: 6 }],
    },
  ],
  decor: [
    { stamp: "pottedPlant", col: 4, row: 3 },
    { stamp: "chairBlue", col: 2, row: 7 },
    { stamp: "smallChest", col: 14, row: 3 },
    { stamp: "clayPot", col: 1, row: 8 },
  ],
  waypoints: [
    { id: "counter", x: 7.5, y: 6.2 },
    { id: "pigeonholes", x: 2, y: 5.2 },
    { id: "mailbag", x: 13, y: 6.2 },
    { id: "calendardesk", x: 12.5, y: 9.2 },
    { id: "letterrack", x: 4.5, y: 8.6 },
  ],
  edges: [
    ["center", "counter"],
    ["center", "pigeonholes"],
    ["center", "mailbag"],
    ["center", "calendardesk"],
    ["center", "letterrack"],
  ],
});
