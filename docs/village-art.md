# Village art

Autarch's village (`/village`) is a small pixel-art town where each agent is a villager. The
villager walks to a building that matches what the agent is doing: the workshop when working,
the town hall when waiting for your approval, home when idle. The art comes from two free asset
packs, and a build script lays out the map.

Tracking issues: #73 (this guide), #84 (art pipeline), #82 (village view), #83 (meeting hall).

## Where the art comes from

| Pack | Author | License | Used for |
| --- | --- | --- | --- |
| [Serene Village](https://limezu.itch.io/serenevillage) | LimeZu | CC BY 4.0, credit required | grass, roads, pond, trees, flowers, signpost, cottages, library |
| [Ninja Adventure](https://pixel-boy.itch.io/ninja-adventure-asset-pack) | Pixel-boy and AAA | CC0 | town hall, workshop, shops, observatory, guard tower, vault, lamps, villagers |

Only the tilesets the village uses are committed, in `public/village/tiles/` and
`public/village/characters/`. `public/village/CREDITS.md` lists every file and where it came from,
and the village shows a credit line in its corner. Keep both when changing the art.

**Choosing other art:** the repo is public, so any pack must allow redistribution (CC0, CC BY,
CC BY-SA and similar). Many popular "free" packs forbid it ("can't be redistributed, even if
modified"), and some forbid use in AI projects. Those can't be committed here.

## How the map is built

One file, `src/components/village/layout.ts`, describes the whole village in tile units:

- **Stamps:** named rectangles cut from the tilesets, e.g. the hall or a tree.
- **Roads:** rectangles, two tiles wide. Edges and corners are picked automatically.
- **Buildings:** each has a label, what it means in the app, the page it opens, its stamp(s) and
  a door waypoint.
- **Decor and lamps:** scenery with no hotspot.
- **Waypoints and edges:** the road graph villagers walk along.

From that file:

- `npm run village:map` composes `public/village/village.png` (drawn 3× for crisp pixels) and
  `public/village/village.tmj`, a [Tiled](https://www.mapeditor.org/) map of the same scene.
  Flowers and bushes are scattered on free grass with a fixed seed, so builds are repeatable.
- The village view derives its hotspots, the night-lamp positions and the walking graph from the
  same file, so they always match the art.
- `npm run test:village` checks the layout:
  - every stamp lies inside its tileset;
  - nothing is off the map or built on a road;
  - nothing overlaps;
  - every waypoint is on a road;
  - every building is reachable.

### Changing the village

1. Edit `layout.ts`: move a building, add a stamp, add a road. To find tile coordinates in a
   tileset, open the PNG in any image viewer with a 16 px grid, or in Tiled.
2. Run `npm run village:map`, then `npm run test:village`.
3. Open `/village?edit=1` to see building outlines, waypoints and coordinates over the art.

The `.tmj` file is generated output. You can open it in Tiled to look around or sketch changes,
but put the changes into `layout.ts`, or the next build will overwrite them.

## Villagers

Characters are Ninja Adventure sprite sheets: 16 px frames, one column per direction (down, up,
left, right) and the walk cycle down the rows. They're listed in `CHARACTERS` in
`src/components/village/manifest.ts`; `AGENT_CHARACTER` picks the one the agent uses. To add one,
copy `Actor/Character/<Name>/SpriteSheet.png` from the pack into `public/village/characters/` and
add it to `CHARACTERS` and to `public/village/CREDITS.md`. The Master (white beard) is reserved
for the Mayor (#58) and the Knight for a possible night watch; see `docs/town-charter.md`.

## UI palette and voice

The interface around the village matches the art.

| Token | Hex | Use |
| --- | --- | --- |
| `parchment` | `#f4ead5` | panels, drawers |
| `wood` | `#6b4a2e` | top bar, buttons |
| `wood-dark` | `#3b2716` | borders, text on parchment |
| `ember` | `#d9643a` | primary action, alerts |
| `moss` | `#5f8a3c` | "working", success |
| `honey` | `#e3b04b` | highlights, money |
| `night` | `#1d2340` | night overlay |

Headings use Pixelify Sans and body text uses Nunito (both SIL Open Font License).

Copy is warm and plain, but never vague about risk:

| Instead of | Write |
| --- | --- |
| PENDING HUMAN APPROVAL (execution #12, risk=high) | **Ada wants to restart nginx — okay?** with the exact command and the risk level underneath |
| Session terminated: time limit reached | Ada ran out of time for this job and headed home. |
| Agent is PAUSED | It's night in the village — everyone's asleep until you wake them. |

## Tools

- `npm run village:map` — rebuild the map from `layout.ts`.
- `npm run pixelate` — snaps an image onto a true pixel grid (nearest-neighbour downscale,
  palette reduction, optional transparent key colour). Useful if you ever add hand-made or
  generated art that isn't quite on a grid.
