// The observatory: the star charts show the sky over the machine — CPU,
// memory, load, disks and the busiest processes.
import { interior } from "./shell";

export const OBSERVATORY_SCENE = interior({
  id: "observatory",
  title: "The observatory",
  ground: [
    { stamp: "windowBlue", col: 3, row: 0 },
    { stamp: "windowBlue", col: 11, row: 0 },
    { stamp: "mapPainting", col: 7, row: 1 },
  ],
  places: [
    {
      id: "charts",
      label: "Star charts",
      role: "The system monitor: CPU, memory, load, disks and processes",
      door: "chart",
      action: "monitor.charts",
      parts: [{ stamp: "starChart", col: 7, row: 4 }],
    },
  ],
  decor: [
    { stamp: "tallBookshelf", col: 1, row: 2 },
    { stamp: "tallBookshelf", col: 13, row: 2 },
    { stamp: "lanternPost", col: 4, row: 3 },
    { stamp: "roundTable", col: 11, row: 6 },
    { stamp: "stumpSeat", col: 10, row: 7 },
    { stamp: "candle", col: 13, row: 6 },
    { stamp: "book", col: 3, row: 6 },
    { stamp: "chairBlue", col: 2, row: 7 },
  ],
  waypoints: [
    { id: "chart", x: 8, y: 6.6 },
    { id: "nook", x: 10, y: 5.6 },
  ],
  edges: [
    ["center", "chart"],
    ["center", "nook"],
  ],
});
