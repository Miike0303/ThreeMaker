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

/**
 * Piecewise-linear day/night ambient intensity factor (C7 WU-02).
 *
 * Control points (minute-of-day → factor):
 * - night 22:00–05:00 → 0.35
 * - dawn ramp 05:00–07:00 → up to 1.0
 * - day 07:00–18:00 → 1.0
 * - dusk ramp 18:00–22:00 → down to 0.35
 *
 * Day-wrap: the table ends at 1440 with the same factor as 0 so interpolation
 * across midnight stays continuous. Exported for tests + WU-04 (routines UI).
 */
const DAY_NIGHT_CURVE: readonly (readonly [minute: number, factor: number])[] = [
  [0, 0.35], // 00:00 night
  [300, 0.35], // 05:00 night end / dawn start
  [420, 1.0], // 07:00 day start
  [1080, 1.0], // 18:00 day end / dusk start
  [1320, 0.35], // 22:00 night start
  [1440, 0.35], // end-of-day wrap (= 00:00)
];

/**
 * Ambient (and non-zero directional) intensity scale for the given whole
 * minute of the day. Linear interpolation between {@link DAY_NIGHT_CURVE}
 * control points; minutes outside `[0, 1440)` wrap modularly.
 */
export function dayNightAmbientFactor(minutes: number): number {
  const day = 1440;
  let m = minutes;
  if (!Number.isFinite(m)) return DAY_NIGHT_CURVE[0]?.[1] ?? 0.35;
  // Modular wrap into [0, 1440).
  m = ((Math.floor(m) % day) + day) % day;

  for (let i = 0; i < DAY_NIGHT_CURVE.length - 1; i++) {
    const a = DAY_NIGHT_CURVE[i];
    const b = DAY_NIGHT_CURVE[i + 1];
    if (!a || !b) continue;
    const [m0, f0] = a;
    const [m1, f1] = b;
    if (m >= m0 && m <= m1) {
      if (m1 === m0) return f0;
      const t = (m - m0) / (m1 - m0);
      return f0 + t * (f1 - f0);
    }
  }
  // Exact end-of-table or unexpected gap — last control point.
  return DAY_NIGHT_CURVE[DAY_NIGHT_CURVE.length - 1]?.[1] ?? 0.35;
}
