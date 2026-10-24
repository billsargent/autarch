// The vault: the ledger records what the agents have spent — tokens and
// dollars by day, week, month and year — and the coffers hold the totals.
import { interior } from "./shell";

export const VAULT_SCENE = interior({
  id: "vault",
  title: "The vault",
  floor: "stoneFloor",
  ground: [{ stamp: "painting", col: 7, row: 1 }],
  places: [
    {
      id: "ledger",
      label: "Ledger",
      role: "Tokens and cost by day, week, month and year",
      door: "ledger",
      action: "usage.ledger",
      parts: [{ stamp: "readingTable", col: 6, row: 5 }],
    },
    {
      id: "coffers",
      label: "Coffers",
      role: "Spending totals: today, this week, month, year and all time",
      door: "coffers",
      action: "usage.totals",
      parts: [
        { stamp: "campChest", col: 11, row: 3 },
        { stamp: "campChest2", col: 12, row: 3 },
        { stamp: "smallChest", col: 13, row: 3 },
      ],
    },
  ],
  decor: [
    { stamp: "chairRed", col: 5, row: 6 },
    { stamp: "chairBlue", col: 8, row: 6 },
    { stamp: "darkDresser", col: 1, row: 2 },
    { stamp: "emptyShelf", col: 3, row: 2 },
    { stamp: "bigBarrel", col: 2, row: 7 },
    { stamp: "clayPot", col: 14, row: 7 },
    { stamp: "lanternPost", col: 14, row: 4 },
  ],
  waypoints: [
    { id: "ledger", x: 7, y: 7.6 },
    { id: "coffers", x: 12.5, y: 4.6 },
  ],
  edges: [
    ["center", "ledger"],
    ["center", "coffers"],
  ],
});
