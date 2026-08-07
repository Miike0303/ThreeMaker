/**
 * Pure helpers for C6 WU-04 opt-in lit tile materials + base scene-light
 * ambient parity. Kept free of DOM / WebGPU so vitest can drive them under
 * `environment: 'node'`.
 *
 * Seam: `main.ts` `buildFloorRender` passes the result of
 * {@link buildSheetLightingOptions} into every floor's `StreamingTilemapScene`
 * options. Scene lights follow {@link baseSceneLightSetup}.
 */
import type { SheetLightingOptions } from '@threemaker/renderer';
import type * as THREE from 'three/webgpu';

/** True when the map authors at least one light (opt-in for lit tile materials). */
export function mapHasAuthoredLights(lights: { readonly length: number }): boolean {
  return lights.length > 0;
}

/**
 * Builds the `lighting` bag for `StreamingTilemapScene` / `createSheetMaterials`.
 * - Map with lights → `{ lit: true, ...lightMap? }` so tiles use Lambert.
 * - Map without lights and no lightMap → `undefined` (byte-identical unlit path).
 * - Map without lights but with a baked lightMap → lightMap-only bag (still Basic).
 */
export function buildSheetLightingOptions(
  hasLights: boolean,
  lightMap?: THREE.Texture,
): SheetLightingOptions | undefined {
  if (!hasLights && !lightMap) return undefined;
  return {
    ...(hasLights ? { lit: true as const } : {}),
    ...(lightMap ? { lightMap } : {}),
  };
}

export interface BaseSceneLightRgb {
  readonly color: number;
  readonly intensity: number;
}

/**
 * Description of the shared scene base lights for a map.
 * `directional: null` means zero / remove the directional (lit ambient-only base).
 */
export interface BaseSceneLightSetup {
  readonly ambient: BaseSceneLightRgb;
  readonly directional: BaseSceneLightRgb | null;
}

/**
 * Unlit maps keep today's exact base lights (they only visibly affect glTF
 * props until tiles are also lit). Lit maps swap to white ambient at Math.PI
 * and drop the directional so tiles get a neutral base from ambient alone.
 *
 * Why Math.PI: three's MeshLambertMaterial energy-conserving diffuse divides
 * by π. Full-white ambient at intensity π therefore approximates the unlit
 * MeshBasicMaterial "map color as-is" look; authored point/spot lights then
 * read as additions on top of that base rather than as the only illumination.
 * Perfect visual parity is a live call — this is the intentional approximation.
 */
export function baseSceneLightSetup(hasLights: boolean): BaseSceneLightSetup {
  if (hasLights) {
    return {
      ambient: { color: 0xffffff, intensity: Math.PI },
      directional: null,
    };
  }
  return {
    ambient: { color: 0x404060, intensity: 2 },
    directional: { color: 0xffffff, intensity: 3 },
  };
}
