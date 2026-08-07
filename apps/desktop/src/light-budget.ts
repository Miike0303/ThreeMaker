/**
 * WebGL2-floor light budget (C6 WU-03): uniform-array lighting via three's
 * default light path. A clustered WebGPU upgrade (WU-04) may raise these
 * limits later, but never below this floor — desktop always rejects maps that
 * exceed these counts so content stays portable to the WebGL2 path.
 *
 * Enforced at map load by `buildMapLights` (loud throw, never silent drop).
 */
export const LIGHT_BUDGET = { maxPoint: 8, maxSpot: 4 } as const;

export type LightBudget = typeof LIGHT_BUDGET;
