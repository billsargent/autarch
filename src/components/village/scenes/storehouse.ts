// The storehouse (#145): the village's stores (everything its trades make),
// the treasury, the orders waiting for the cart, and the ledger of what came
// in and went out.
import { interior } from "./shell";

export const STOREHOUSE_SCENE = interior({
  id: "storehouse",
  title: "The storehouse",
  floor: "stoneFloor",
  ground: [{ stamp: "mapPainting", col: 7, row: 1 }],
  places: [
    {
      id: "stores",
      label: "The stores",
      role: "Every good the village has: wheat, bread, fish, flowers, crafts and ale",
      door: "stores",
      action: "store.stores",
      parts: [
        { stamp: "bigBarrel", col: 2, row: 3 },
        { stamp: "sack", col: 4, row: 4 },
        { stamp: "sackOpen", col: 5, row: 4 },
      ],
    },
    {
      id: "cart",
      label: "The cart",
      role: "Orders from other towns: what's taken on, and what's still short",
      door: "cart",
      action: "store.orders",
      parts: [{ stamp: "handcart", col: 11, row: 5 }],
    },
    {
      id: "ledger",
      label: "The storekeeper's ledger",
      role: "What the village made, ate and sent away lately, and the treasury",
      door: "ledger",
      action: "store.ledger",
      parts: [{ stamp: "writingDesk", col: 7, row: 6 }],
    },
  ],
  decor: [
    { stamp: "crateSmall", col: 1, row: 7 },
    { stamp: "crateSmall", col: 2, row: 8 },
    { stamp: "barrelBands", col: 13, row: 3 },
    { stamp: "barrelBands", col: 14, row: 3 },
    { stamp: "produceCrate", col: 14, row: 8 },
    { stamp: "lumber", col: 12, row: 8 },
    { stamp: "plankStack", col: 13, row: 8 },
    { stamp: "lanternPost", col: 9, row: 3 },
  ],
  waypoints: [
    { id: "stores", x: 4, y: 6.6 },
    { id: "cart", x: 12, y: 7.6 },
    { id: "ledger", x: 8, y: 8.6 },
  ],
  edges: [
    ["center", "stores"],
    ["center", "cart"],
    ["center", "ledger"],
  ],
});
