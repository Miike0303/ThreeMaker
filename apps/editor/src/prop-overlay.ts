/** Painter prop-placement overlay: prop markers on one floor (see `floor-overlay.ts`). */

import type { PropDocument } from '@threemaker/map-format';
import { computeFloorOverlayPoints, type FloorOverlayPoint } from './floor-overlay.js';

export type PropOverlayPoint = FloorOverlayPoint;

/** Every prop marker on `floorId` (props may share a tile, so this is a list, never a single point like spawn). */
export function computePropOverlayPoints(
  props: readonly PropDocument[],
  floorId: string,
): readonly PropOverlayPoint[] {
  return computeFloorOverlayPoints(props, floorId);
}
