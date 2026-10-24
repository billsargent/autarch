// The owner's home (#110). One room in three corners: the study (the
// computer, the bookshelves, the desk with the day's papers), the hearth
// (invite a villager over) and the bedroom (the bed and the guitar). The wall
// calendar shows what's coming up. Empty spots are left for improvements
// later: see HOME_UPGRADE_SLOTS.
import type { Rect } from "../scene";
import { interior } from "./shell";

export const HOME_SCENE = interior({
  id: "home",
  title: "Your home",
  ground: [
    { stamp: "windowBlue", col: 3, row: 0 },
    { stamp: "windowRed", col: 11, row: 0 },
    { stamp: "painting", col: 6, row: 1 },
    { stamp: "bigRug", col: 6, row: 5 },
  ],
  places: [
    {
      id: "computer",
      label: "Your computer",
      role: "The machine's vital signs, and the way to every record",
      door: "computer",
      action: "home.computer",
      parts: [
        { stamp: "computerDesk", col: 1, row: 3 },
        { stamp: "chairBlue", col: 2, row: 5 },
      ],
    },
    {
      id: "shelves",
      label: "Bookshelves",
      role: "Something to read: the villagers' diaries",
      door: "shelves",
      action: "home.books",
      parts: [
        { stamp: "tallBookshelf", col: 3, row: 2 },
        { stamp: "bookshelf", col: 5, row: 2 },
      ],
    },
    {
      id: "calendar",
      label: "Wall calendar",
      role: "What's coming up: jobs, bedtime and wake-up",
      door: "calendar",
      action: "home.calendar",
      parts: [{ stamp: "wallCalendar", col: 8, row: 1 }],
    },
    {
      id: "desk",
      label: "Your desk",
      role: "Papers waiting on you: approvals, hire requests and letters",
      door: "desk",
      action: "home.desk",
      parts: [{ stamp: "writingDesk", col: 1, row: 7 }],
    },
    {
      id: "armchair",
      label: "Armchair by the hearth",
      role: "Invite a villager over to talk",
      door: "hearth",
      action: "home.invite",
      parts: [
        { stamp: "hearth", col: 9, row: 3 },
        { stamp: "chairRed", col: 11, row: 4 },
      ],
    },
    {
      id: "keepsakes",
      label: "Keepsake chest",
      role: "What the village has done for you: adopted ideas, finished goals, sent work",
      door: "keepsakes",
      action: "home.keepsakes",
      parts: [{ stamp: "campChest", col: 4, row: 8 }],
    },
    {
      id: "maptable",
      label: "Map table",
      role: "The land around the village: plots, building proposals, building",
      door: "map",
      action: "home.map",
      parts: [{ stamp: "readingTable", col: 10, row: 7 }],
    },
    {
      id: "pantry",
      label: "Pantry",
      role: "The village's wheat and bread",
      door: "pantry",
      action: "home.pantry",
      parts: [{ stamp: "drawers", col: 14, row: 7 }],
    },
    {
      id: "guitar",
      label: "Guitar",
      role: "Play a few chords",
      door: "guitar",
      action: "home.guitar",
      parts: [{ stamp: "guitar", col: 12, row: 3 }],
    },
  ],
  decor: [
    { stamp: "bedRed", col: 13, row: 3 },
    { stamp: "pottedPlant", col: 8, row: 3 },
    { stamp: "clayPot", col: 13, row: 8 },
  ],
  waypoints: [
    { id: "computer", x: 2.5, y: 6.4 },
    { id: "shelves", x: 5, y: 4.8 },
    { id: "calendar", x: 8.5, y: 4.6 },
    { id: "desk", x: 3.5, y: 8.8 },
    { id: "hearth", x: 10.5, y: 6.2 },
    { id: "guitar", x: 12.5, y: 6 },
    { id: "bed", x: 13.5, y: 6.8 },
    { id: "map", x: 11, y: 9.5 },
    { id: "keepsakes", x: 4.5, y: 9.6 },
    { id: "pantry", x: 13.6, y: 9.5 },
  ],
  edges: [
    ["center", "computer"],
    ["center", "shelves"],
    ["center", "calendar"],
    ["center", "desk"],
    ["center", "hearth"],
    ["center", "guitar"],
    ["center", "bed"],
    ["center", "map"],
    ["center", "keepsakes"],
    ["map", "pantry"],
  ],
});

// Free floor and wall kept for later: a radio, a picture frame, a workbench,
// personal touches, or the door to an annex (#110).
export const HOME_UPGRADE_SLOTS: Array<{ id: string; rect: Rect; note: string }> = [
  { id: "wall-right", rect: { col: 13, row: 1, w: 2, h: 1 }, note: "a picture or a shelf on the bedroom wall" },
  { id: "corner-front-right", rect: { col: 11, row: 8, w: 2, h: 1 }, note: "a floor spot by the bed" },
];
