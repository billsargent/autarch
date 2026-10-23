import type { SceneLayout } from "../scene";
import { COTTAGE_SCENE } from "./cottage";
import { GUARDTOWER_SCENE } from "./guardtower";
import { LIBRARY_SCENE } from "./library";
import { OBSERVATORY_SCENE } from "./observatory";
import { TOWNHALL_SCENE } from "./townhall";
import { VAULT_SCENE } from "./vault";
import { VILLAGE_SCENE } from "./village";
import { WORKSHOP_SCENE } from "./workshop";

export { VILLAGE_SCENE } from "./village";

// Every building interior, by scene id (the `interior` of a village place).
export const INTERIORS: Record<string, SceneLayout> = {
  library: LIBRARY_SCENE,
  workshop: WORKSHOP_SCENE,
  guardtower: GUARDTOWER_SCENE,
  observatory: OBSERVATORY_SCENE,
  vault: VAULT_SCENE,
  townhall: TOWNHALL_SCENE,
  cottage: COTTAGE_SCENE,
};

export const ALL_SCENES: SceneLayout[] = [VILLAGE_SCENE, ...Object.values(INTERIORS)];
