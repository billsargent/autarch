// How a villager can look: a Ninja Adventure character sprite and an accent
// colour. Plain data, safe to import on the server and in the browser; the
// village maps each key to its sprite sheet (components/village/manifest.ts).
// New looks come from the pack via scripts/import-characters.ts (#138).

export const CHARACTER_KEYS = [
  // The first looks (#56).
  "master",
  "woman",
  "villager",
  "villager2",
  "villager3",
  "villager4",
  "oldwoman",
  "inspector",
  "knight",
  // More folk, elders, travellers and oddballs (#138).
  "boy",
  "lady",
  "villager5",
  "villager6",
  "villager7",
  "eggboy",
  "egggirl",
  "woodsman",
  "hunter",
  "oldman",
  "oldman2",
  "oldman3",
  "monk",
  "monk2",
  "herbalist",
  "traveller",
  "swordsman",
  "swordsman2",
  "merchant",
  "merchant2",
  "noble",
  "forager",
  "forager2",
  "strongman",
  "strongman2",
  "lionboy",
  "frogmask",
  "racoonmask",
  "bearmask",
  // Clothing-colour variants (made by the import script).
  "villager-rose",
  "villager-plum",
  "villager-olive",
  "villager-gold",
  "woman-rose",
  "woman-plum",
  "woman-olive",
  "woman-gold",
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
  boy: "Red-haired lad",
  lady: "Lady with a bow",
  villager5: "Villager in a cap",
  villager6: "Villager with a topknot",
  villager7: "Bearded villager",
  eggboy: "Lad in an eggshell cap",
  egggirl: "Lass in an eggshell cap",
  woodsman: "Woodsman in green",
  hunter: "Hunter in a bandana",
  oldman: "Old gardener",
  oldman2: "Old man in a beanie",
  oldman3: "Old sage",
  monk: "Monk",
  monk2: "Bald monk",
  herbalist: "Herbalist in a big hat",
  traveller: "Traveller in a parka",
  swordsman: "Swordsman",
  swordsman2: "Swordsman in blue",
  merchant: "Merchant",
  merchant2: "Merchant in a turban",
  noble: "Noble in a top hat",
  forager: "Wild-haired forager",
  forager2: "Forager in furs",
  strongman: "Bald strongman",
  strongman2: "Quiet strongman",
  lionboy: "Lad in a lion hood",
  frogmask: "Frog-masked oddball",
  racoonmask: "Racoon-masked rascal",
  bearmask: "Bear-masked oddball",
  "villager-rose": "Villager in rose",
  "villager-plum": "Villager in plum",
  "villager-olive": "Villager in olive",
  "villager-gold": "Villager in gold",
  "woman-rose": "Young woman in rose",
  "woman-plum": "Young woman in plum",
  "woman-olive": "Young woman in olive",
  "woman-gold": "Young woman in gold",
};

// How the look picker groups them.
export const CHARACTER_GROUPS: Array<{ label: string; keys: CharacterKey[] }> = [
  {
    label: "Folk",
    keys: ["villager", "villager2", "villager3", "villager4", "villager5", "villager6", "villager7", "woman", "lady", "boy", "eggboy", "egggirl", "woodsman", "hunter"],
  },
  { label: "Colours", keys: ["villager-rose", "villager-plum", "villager-olive", "villager-gold", "woman-rose", "woman-plum", "woman-olive", "woman-gold"] },
  { label: "Elders", keys: ["master", "oldwoman", "oldman", "oldman2", "oldman3", "monk", "monk2", "herbalist"] },
  { label: "Travellers", keys: ["inspector", "knight", "traveller", "swordsman", "swordsman2", "merchant", "merchant2", "noble"] },
  { label: "Quirky", keys: ["forager", "forager2", "strongman", "strongman2", "lionboy", "frogmask", "racoonmask", "bearmask"] },
];

// Where the import script finds each new look in the pack (Actor/Character/<folder>).
export const CHARACTER_SOURCES: Partial<Record<CharacterKey, string>> = {
  boy: "Boy",
  lady: "Princess",
  villager5: "Villager5",
  villager6: "Villager6",
  villager7: "Village6",
  eggboy: "EggBoy",
  egggirl: "EggGirl",
  woodsman: "ManGreen",
  hunter: "Hunter",
  oldman: "OldMan",
  oldman2: "OldMan2",
  oldman3: "OldMan3",
  monk: "Monk",
  monk2: "Monk2",
  herbalist: "Shaman",
  traveller: "Eskimo",
  swordsman: "Samurai",
  swordsman2: "SamuraiBlue",
  merchant: "Sultan",
  merchant2: "Sultan2",
  noble: "Noble",
  forager: "Cavegirl",
  forager2: "Cavegirl2",
  strongman: "Caveman",
  strongman2: "Caveman2",
  lionboy: "LionBoy",
  frogmask: "MaskFrog",
  racoonmask: "MaskRacoon",
  bearmask: "MaskGoldRacoon",
};

// Clothing-colour variants: the Villager and Woman sheets dress in the same
// two blues (548789, 79b8ce) with a dark trim (2e3939); only those change.
const tint = (mid: string, light: string, dark: string) => ({ "548789": mid, "79b8ce": light, "2e3939": dark });
const TINTS = {
  rose: tint("a64c6b", "e08aa6", "4a2030"),
  plum: tint("6a4c93", "a389d4", "2f2240"),
  olive: tint("6b7a2e", "a8b44a", "2e3414"),
  gold: tint("a8742a", "e3b04b", "4a3414"),
};
export const CHARACTER_VARIANTS: Partial<Record<CharacterKey, { base: string; swap: Record<string, string> }>> = Object.fromEntries(
  (["villager", "woman"] as const).flatMap((base) =>
    (Object.keys(TINTS) as Array<keyof typeof TINTS>).map((t) => [`${base}-${t}`, { base: base === "villager" ? "Villager" : "Woman", swap: TINTS[t] }]),
  ),
);

// A look that suits a village trade (#131), for new villagers and hires.
export const TRADE_LOOKS: Record<string, CharacterKey[]> = {
  farmer: ["villager2", "woodsman", "eggboy", "villager-olive"],
  baker: ["woman", "villager5", "woman-gold", "egggirl"],
  innkeeper: ["villager7", "strongman", "villager4"],
  gardener: ["oldman", "herbalist", "woman-olive", "villager2"],
  shopkeeper: ["merchant", "merchant2", "lady", "woman-rose"],
  carpenter: ["strongman2", "villager6", "hunter"],
  trader: ["traveller", "merchant2", "noble"],
  scholar: ["monk", "master", "oldman3"],
  watchman: ["knight", "swordsman", "swordsman2"],
};

export const VILLAGER_COLORS = ["#d9643a", "#4f86c6", "#5f8a3c", "#9b59b6", "#e3b04b", "#2a9d8f", "#c2185b", "#6d4c41"];

export function isCharacterKey(v: unknown): v is CharacterKey {
  return typeof v === "string" && (CHARACTER_KEYS as readonly string[]).includes(v);
}
