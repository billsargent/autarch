# Village art credits

The village art is built from two free asset packs. Only the files listed here are included in
this repository; get the full packs from their authors.

## Serene Village — LimeZu

- Pack: "Serene Village - RPG Tileset [16X16]" v1.2, by LimeZu
- Source: https://limezu.itch.io/serenevillage
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as stated on the pack's
  page. The download contains no separate license file.
- Files used: `tiles/serene-village-outside.png` (from `16x16_original/Serene Village - Outside.png`,
  unmodified)
- Used for the grass, dirt roads, pond, trees, flowers, signpost, mailbox and the cottage and
  library houses.

## Ninja Adventure — Pixel-boy and AAA

- Pack: "Ninja Adventure - Asset Pack", by Pixel-boy and AAA
- Source: https://pixel-boy.itch.io/ninja-adventure-asset-pack
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, per the
  pack's `LICENSE.txt`). Attribution is not required but appreciated.
- Files used, unmodified:
  - `tiles/ninja-house.png` (`Backgrounds/Tilesets/TilesetHouse.png`)
  - `tiles/ninja-element.png` (`Backgrounds/Tilesets/TilesetElement.png`)
  - `tiles/ninja-nature.png` (`Backgrounds/Tilesets/TilesetNature.png`)
  - `characters/*.png` (`Actor/Character/<Name>/SpriteSheet.png`)
- Used for the town hall, workshop, market, shops, observatory, guard tower, vault, lamps, some
  trees, and the villagers.

## Generated files

`village.png` and `village.tmj` are composed from the tiles above by `npm run village:map`
(`scripts/build-village-map.ts`). They are adaptations of the works above and carry the same
credits.
