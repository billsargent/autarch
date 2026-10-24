# Village art credits

The village art is built from two free asset packs. Only the files listed here are included in
this repository; get the full packs from their authors.

## Serene Village — LimeZu

- Pack: "Serene Village - RPG Tileset [16X16]" v1.2, by LimeZu
- Source: https://limezu.itch.io/serenevillage
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as stated on the pack's
  page. The download contains no separate license file.
- Files used, unmodified:
  - `tiles/serene-village-outside.png` (`16x16_original/Serene Village - Outside.png`)
  - `tiles/serene-village-inside.png` (`16x16_original/Serene Village - Inside.png`)
- Used for the grass, dirt roads, pond, trees, flowers, signpost, mailbox and the cottage and
  library houses outside, and for the walls, windows, rugs, desks, tables and shelves inside.

## Ninja Adventure — Pixel-boy and AAA

- Pack: "Ninja Adventure - Asset Pack", by Pixel-boy and AAA
- Source: https://pixel-boy.itch.io/ninja-adventure-asset-pack
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, per the
  pack's `LICENSE.txt`). Attribution is not required but appreciated.
- Files used, unmodified:
  - `tiles/ninja-house.png` (`Backgrounds/Tilesets/TilesetHouse.png`)
  - `tiles/ninja-element.png` (`Backgrounds/Tilesets/TilesetElement.png`)
  - `tiles/ninja-nature.png` (`Backgrounds/Tilesets/TilesetNature.png`)
  - `tiles/ninja-floor.png` (`Backgrounds/Tilesets/Interior/TilesetInteriorFloor.png`)
  - `tiles/ninja-wall.png` (`Backgrounds/Tilesets/Interior/TilesetWallSimple.png`)
  - `tiles/ninja-camp.png` (`Backgrounds/Tilesets/tileset_camp.png`)
  - `tiles/ninja-bed.png` (`Backgrounds/Tilesets/tileset_bed.png`)
  - `characters/*.png` (`Actor/Character/<Name>/SpriteSheet.png`)
- Used for the town hall, workshop, market, shops, observatory, guard tower, vault, lamps, some
  trees and the villagers outside; and inside, for the floors, wall rims, furniture, crates,
  barrels, chests, maps, lanterns, the hearth and the beds.

## Drawn for this project

- `tiles/autarch-custom.png`, made by `npm run village:custom-art` (`scripts/build-custom-tiles.ts`):
  a computer with a keyboard, mouse and mug, an acoustic guitar and a wall calendar, drawn pixel
  by pixel for this project. The computer sits on the Serene Village writing desk (LimeZu,
  CC BY 4.0, above), copied in unmodified.

## Sound

- `audio/day.ogg` (`Audio/Musics/5 - Peaceful.ogg`), `audio/night.ogg` (`Audio/Musics/27 - Chill.ogg`),
  `audio/alert.wav` (`Audio/Sounds/Alert/Alert.wav`) and `audio/letter.wav`
  (`Audio/Sounds/Bonus/Coin.wav`): from the Ninja Adventure pack by Pixel-boy and AAA (CC0),
  unmodified. Off until the owner switches sound on in the village bar.

## Generated files

Every scene's `scenes/<id>.png` and `scenes/<id>.tmj` (the village and each room) is composed
from the tiles above by `npm run village:map`
(`scripts/build-village-map.ts`). They are adaptations of the works above and carry the same
credits.
