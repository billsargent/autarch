// How a villager can look: a Ninja Adventure character sprite and an accent
// colour. Plain data, safe to import on the server and in the browser; the
// village maps each key to its sprite sheet (components/village/manifest.ts).

export const CHARACTER_KEYS = [
  "master",
  "woman",
  "villager",
  "villager2",
  "villager3",
  "villager4",
  "oldwoman",
  "inspector",
  "knight",
] as const;

export type CharacterKey = (typeof CHARACTER_KEYS)[number];

export const CHARACTER_LABELS: Record<CharacterKey, string> = {
  master: "Elder in robes",
  woman: "Young woman",
  villager: "Villager",
  villager2: "Villager in green",
  villager3: "Villager in blue",
  villager4: "Villager in red",
  oldwoman: "Old woman",
  inspector: "Inspector",
  knight: "Knight",
};

export const VILLAGER_COLORS = ["#d9643a", "#4f86c6", "#5f8a3c", "#9b59b6", "#e3b04b", "#2a9d8f", "#c2185b", "#6d4c41"];

export function isCharacterKey(v: unknown): v is CharacterKey {
  return typeof v === "string" && (CHARACTER_KEYS as readonly string[]).includes(v);
}
