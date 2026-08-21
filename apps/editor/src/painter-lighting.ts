/**
 * Painter preview lighting — same opt-in seam as desktop `buildFloorRender`.
 * Pure so vitest can lock it without WebGPU.
 */
import type { LightDocument } from '@threemaker/map-format';
import type { BaseSceneLightSetup, SheetLightingOptions } from '@threemaker/renderer';
import {
  baseSceneLightSetup,
  buildSheetLightingOptions,
  mapHasAuthoredLights,
} from '@threemaker/renderer';

/** Today's unlit painter chrome (Ambient 0x808090@2.5 + Directional@2). */
export const PAINTER_UNLIT_BASE: BaseSceneLightSetup = {
  ambient: { color: 0x808090, intensity: 2.5 },
  directional: { color: 0xffffff, intensity: 2 },
};

export function painterHasAuthoredLights(lights: { readonly length: number }): boolean {
  return mapHasAuthoredLights(lights);
}

export function painterSheetLighting(lights: {
  readonly length: number;
}): SheetLightingOptions | undefined {
  return buildSheetLightingOptions(mapHasAuthoredLights(lights));
}

export function painterBaseLightSetup(lights: { readonly length: number }): BaseSceneLightSetup {
  return mapHasAuthoredLights(lights) ? baseSceneLightSetup(true) : PAINTER_UNLIT_BASE;
}

/** Placed lights on the active floor, plus attached lights (player / NPC). */
export function painterPreviewLights(
  lights: readonly LightDocument[],
  activeFloorId: string,
): readonly LightDocument[] {
  return lights.filter((light) => light.attach !== undefined || light.floor === activeFloorId);
}
