// The workshop: the agent's scheduled jobs are slips pinned to the job board,
// and new jobs are set up at the workbench.
import { interior } from "./shell";

export const WORKSHOP_SCENE = interior({
  id: "workshop",
  title: "The workshop",
  ground: [
    { stamp: "windowBlue", col: 3, row: 0 },
    { stamp: "windowRed", col: 11, row: 0 },
  ],
  places: [
    {
      id: "board",
      label: "Job board",
      role: "The agent's scheduled jobs — open a slip to run, pause, edit or check its history",
      door: "board",
      action: "jobs.board",
      parts: [{ stamp: "jobBoard", col: 6, row: 3 }],
    },
    {
      id: "bench",
      label: "Workbench",
      role: "Set up a new job",
      door: "bench",
      action: "jobs.new",
      parts: [{ stamp: "workbench", col: 2, row: 6 }],
    },
  ],
  decor: [
    { stamp: "toolShelf", col: 12, row: 2 },
    { stamp: "drawers", col: 1, row: 2 },
    { stamp: "grindstone", col: 1, row: 6 },
    { stamp: "scrapPile", col: 5, row: 6 },
    { stamp: "ropeCoil", col: 4, row: 3 },
    { stamp: "sack", col: 2, row: 3 },
    { stamp: "sackOpen", col: 3, row: 3 },
    { stamp: "lumber", col: 10, row: 3 },
    { stamp: "plankStack", col: 11, row: 3 },
    { stamp: "barrelBands", col: 14, row: 3 },
    { stamp: "stump", col: 11, row: 7 },
    { stamp: "handcart", col: 12, row: 7 },
    { stamp: "chest", col: 14, row: 5 },
  ],
  waypoints: [
    { id: "board", x: 7.5, y: 4.6 },
    { id: "bench", x: 3.5, y: 7.6 },
    { id: "pile", x: 10.5, y: 6.6 },
  ],
  edges: [
    ["center", "board"],
    ["center", "bench"],
    ["center", "pile"],
  ],
});
