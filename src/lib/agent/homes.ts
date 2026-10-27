// Where everyone lives (#159). The three cottages hold the village's first
// villagers (their beds together match the population setting); every house
// built on a plot adds two more beds. A villager keeps their home; newcomers
// take the first free bed. The Mayor lives in the cottages too. Plain
// functions, safe in the browser; agents.ts keeps the homes in the database.

export const COTTAGES = 3;
export const HOUSE_BEDS = 2;
export const COTTAGE_NAMES = ["the red cottage", "the blue cottage", "the big cottage"];

export interface Dwelling {
  id: string;
  beds: number;
}

// The homes the village has: the cottages, and the houses that stand.
export function dwellingsFor(maxPopulation: number, houseIds: number[]): Dwelling[] {
  const per = Math.max(1, Math.ceil(maxPopulation / COTTAGES));
  return [
    ...Array.from({ length: COTTAGES }, (_, i) => ({ id: `cottage-${i + 1}`, beds: per })),
    ...houseIds.map((id) => ({ id: `house-${id}`, beds: HOUSE_BEDS })),
  ];
}

// Who lives where. Pure: everyone keeps a home that still has room for them
// (oldest first); the rest take the first free bed, or none if the village is
// out of beds.
export function assignHomes(villagers: Array<{ id: number; dwelling: string | null }>, dwellings: Dwelling[]): Map<number, string | null> {
  const left = new Map(dwellings.map((d) => [d.id, d.beds]));
  const out = new Map<number, string | null>();
  const byId = [...villagers].sort((a, b) => a.id - b.id);
  for (const v of byId) {
    const room = v.dwelling ? left.get(v.dwelling) : undefined;
    if (v.dwelling && room && room > 0) {
      out.set(v.id, v.dwelling);
      left.set(v.dwelling, room - 1);
    }
  }
  for (const v of byId) {
    if (out.has(v.id)) continue;
    const free = dwellings.find((d) => (left.get(d.id) ?? 0) > 0);
    out.set(v.id, free?.id ?? null);
    if (free) left.set(free.id, left.get(free.id)! - 1);
  }
  return out;
}

// "cottage-2" → "the blue cottage"; "house-7" → "a house on the plots".
export function dwellingLabel(dwelling: string | null | undefined): string | null {
  if (!dwelling) return null;
  const m = /^cottage-(\d+)$/.exec(dwelling);
  if (m) return COTTAGE_NAMES[Number(m[1]) - 1] ?? "a cottage";
  return dwelling.startsWith("house-") ? "a house on the plots" : null;
}
