// The library: the agent's skills (markdown playbooks) live on the shelves,
// and new ones are written at the desk. The reading table is the document
// shelf (#169): the owner's documents and the village's research.
import { interior } from "./shell";

export const LIBRARY_SCENE = interior({
  id: "library",
  title: "The library",
  ground: [
    { stamp: "windowRed", col: 3, row: 0 },
    { stamp: "windowBlue", col: 11, row: 0 },
    { stamp: "bigRug", col: 6, row: 5 },
  ],
  places: [
    {
      id: "shelves",
      label: "Bookshelves",
      role: "The agent's skills — open one to read or edit it",
      door: "shelf",
      action: "skills.browse",
      parts: [
        { stamp: "bookshelf", col: 1, row: 2 },
        { stamp: "tallBookshelf", col: 6, row: 2 },
        { stamp: "tallBookshelf", col: 8, row: 2 },
        { stamp: "bookshelf", col: 13, row: 2 },
      ],
    },
    {
      id: "desk",
      label: "Writing desk",
      role: "Write a new skill",
      door: "desk",
      action: "skills.new",
      parts: [{ stamp: "writingDesk", col: 2, row: 6 }],
    },
    {
      id: "reading",
      label: "Reading table",
      role: "The document shelf: your documents and the village's research",
      door: "table",
      action: "library.documents",
      parts: [{ stamp: "readingTable", col: 11, row: 6 }],
    },
  ],
  decor: [
    { stamp: "chairRed", col: 10, row: 6 },
    { stamp: "chairBlue", col: 13, row: 6 },
    { stamp: "pottedPlant", col: 1, row: 4 },
    { stamp: "pottedPlant", col: 14, row: 4 },
  ],
  waypoints: [
    { id: "shelf", x: 8, y: 4.6 },
    { id: "desk", x: 3, y: 8.6 },
    { id: "table", x: 12, y: 8.6 },
  ],
  edges: [
    ["center", "shelf"],
    ["center", "desk"],
    ["center", "table"],
  ],
});
