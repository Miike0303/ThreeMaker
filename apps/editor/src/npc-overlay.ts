/** Painter NPC-placement overlay: NPC markers on one floor (see `floor-overlay.ts`). */

import type { NpcDocument } from '@threemaker/map-format';
import { computeFloorOverlayPoints, type FloorOverlayPoint } from './floor-overlay.js';

export type NpcOverlayPoint = FloorOverlayPoint;

/** Every NPC marker on `floorId` (schema forbids two NPCs on the same base tile per floor). */
export function computeNpcOverlayPoints(
  npcs: readonly NpcDocument[],
  floorId: string,
): readonly NpcOverlayPoint[] {
  return computeFloorOverlayPoints(npcs, floorId);
}
