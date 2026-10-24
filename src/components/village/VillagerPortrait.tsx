import { SPRITE, spriteFor } from "./manifest";

// A villager's face: the first frame of their sprite (facing the viewer),
// framed in their colour.
export default function VillagerPortrait({ character, color, size = 32, title }: { character: string; color?: string; size?: number; title?: string }) {
  const scale = size / SPRITE.frame;
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
      className="inline-block shrink-0 rounded-sm border-2"
      style={{
        width: size + 4,
        height: size + 4,
        borderColor: color ?? "#3b2716",
        background: `${color ?? "#3b2716"}22`,
      }}
    >
      <span
        className="block"
        style={{
          width: size,
          height: size,
          backgroundImage: `url(${spriteFor(character)})`,
          backgroundSize: `${SPRITE.sheetWidth * scale}px ${SPRITE.sheetHeight * scale}px`,
          backgroundPosition: "0 0",
          imageRendering: "pixelated",
        }}
      />
    </span>
  );
}
