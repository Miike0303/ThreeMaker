/**
 * Painter light-placement authoring overlay (schema v6 WU-LIGHT-02). Pure --
 * mirrors `npc-overlay.ts`/`trigger-overlay.ts`: exposes each *placed*
 * light's tile-space position on the given floor for `painter-viewport.ts`
 * to project to a screen-space fraction. Attached lights (`attach` only)
 * have no floor/x/y and are excluded.
 */

import type { LightDocument } from '@threemaker/map-format';

export interface LightOverlayPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: LightDocument['kind'];
  readonly color: string;
}

/**
 * Every placed light marker on `floorId`. Lights MAY share a tile (schema),
 * so this is a list. Attached lights are omitted.
 */
export function computeLightOverlayPoints(
  lights: readonly LightDocument[],
  floorId: string,
): readonly LightOverlayPoint[] {
  const out: LightOverlayPoint[] = [];
  for (const light of lights) {
    if (light.floor !== floorId) continue;
    if (light.x === undefined || light.y === undefined) continue;
    out.push({
      id: light.id,
      x: light.x,
      y: light.y,
      kind: light.kind,
      color: light.color,
    });
  }
  return out;
}
