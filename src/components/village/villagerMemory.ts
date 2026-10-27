// Where villagers were (#181): remembered in this browser, per scene, so a
// visit or a reload doesn't send everyone running from the gate. A villager
// with nothing remembered (or remembered long ago) simply starts where they
// belong now; one remembered mid-walk a moment ago carries on from there.

const POSITIONS_KEY = "autarch.villagerPositions";
// Older than this, a remembered spot is stale: the villager starts at their place.
export const REMEMBER_MS = 2 * 60_000;
export interface Remembered {
  x: number;
  y: number;
  target: string;
  at: number;
}
let positions: Record<string, Remembered> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function allPositions(): Record<string, Remembered> {
  if (positions) return positions;
  try {
    positions = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "{}") as Record<string, Remembered>;
  } catch {
    positions = {};
  }
  return positions;
}

export function remember(key: string, spot: Remembered, now = false) {
  const all = allPositions();
  all[key] = spot;
  const write = () => {
    saveTimer = null;
    try {
      // Only what's recent is worth keeping.
      for (const k of Object.keys(all)) if (Date.now() - all[k].at > REMEMBER_MS * 30) delete all[k];
      localStorage.setItem(POSITIONS_KEY, JSON.stringify(all));
    } catch {
      /* private window or storage full: positions just aren't kept */
    }
  };
  if (now) {
    if (saveTimer) clearTimeout(saveTimer);
    write();
  } else if (!saveTimer) saveTimer = setTimeout(write, 1000);
}

// Where a villager should appear when the scene opens.
export function startingSpot(
  remembered: Remembered | undefined,
  target: { id: string; x: number; y: number },
  now = Date.now(),
): { x: number; y: number; reached: string | null } {
  if (!remembered || now - remembered.at > REMEMBER_MS || remembered.target === target.id) return { x: target.x, y: target.y, reached: target.id };
  return { x: remembered.x, y: remembered.y, reached: null };
}
