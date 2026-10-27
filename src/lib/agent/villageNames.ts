// Names for newcomers (#151): when whoever drafts a hire doesn't name them,
// the village picks a free one from this list. A mix of old village names.
export const VILLAGE_NAMES = [
  "Ada", "Agnes", "Alba", "Alma", "Amos", "Anna", "Ansel", "Arlo", "Asa", "Ava",
  "Beatrix", "Bess", "Blythe", "Bran", "Briar", "Cal", "Cass", "Cecily", "Clara", "Clem",
  "Colm", "Cora", "Dara", "Del", "Dora", "Dot", "Edie", "Edmund", "Effie", "Elias",
  "Elsie", "Emmet", "Enid", "Esme", "Ezra", "Fen", "Fern", "Finn", "Flora", "Frida",
  "Gil", "Greta", "Gus", "Hal", "Hattie", "Hazel", "Hugo", "Ida", "Ines", "Ivo",
  "Ivy", "Jago", "Jem", "Jo", "Jude", "June", "Kit", "Lark", "Laurel", "Len",
  "Lettie", "Linus", "Lou", "Mabel", "Mae", "Maud", "Mags", "Milo", "Moll", "Nell",
  "Ned", "Nia", "Nico", "Nora", "Odo", "Olive", "Orla", "Otto", "Pell", "Pip",
  "Piers", "Poppy", "Quill", "Rafe", "Remy", "Rhea", "Rook", "Rosa", "Rowan", "Ruth",
  "Sable", "Sage", "Sam", "Silas", "Sol", "Tam", "Tansy", "Tess", "Theo", "Tilly",
  "Tobin", "Una", "Uri", "Vera", "Vida", "Wren", "Will", "Winnie", "Yara", "Zeb",
];

// A name nobody in the village has yet (`taken`, any case), or null if every
// one is in use.
export function freeName(taken: string[], rng: () => number = Math.random): string | null {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const free = VILLAGE_NAMES.filter((n) => !used.has(n.toLowerCase()));
  return free.length ? free[Math.floor(rng() * free.length)] : null;
}
