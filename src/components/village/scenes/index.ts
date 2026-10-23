import type { SceneLayout } from "../scene";
import { LIBRARY_SCENE } from "./library";
import { VILLAGE_SCENE } from "./village";

export { VILLAGE_SCENE } from "./village";

// Every building interior, by scene id (the `interior` of a village place).
export const INTERIORS: Record<string, SceneLayout> = {
  library: LIBRARY_SCENE,
};

export const ALL_SCENES: SceneLayout[] = [VILLAGE_SCENE, ...Object.values(INTERIORS)];
