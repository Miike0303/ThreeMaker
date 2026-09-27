/** Painter trigger-placement overlay: trigger markers on one floor (see `floor-overlay.ts`). */

import type { TriggerDocument } from '@threemaker/map-format';
import { computeFloorOverlayPoints, type FloorOverlayPoint } from './floor-overlay.js';

export type TriggerOverlayPoint = FloorOverlayPoint;

/** Every trigger marker on `floorId` (triggers may share a tile; this is a list). */
export function computeTriggerOverlayPoints(
  triggers: readonly TriggerDocument[],
  floorId: string,
): readonly TriggerOverlayPoint[] {
  return computeFloorOverlayPoints(triggers, floorId);
}
