/**
 * Painter prop-placement authoring overlay (C5 WU-04 depth-props-hd). Pure --
 * mirrors `spawn-overlay.ts`/`stair-overlay.ts`: exposes each prop's
 * tile-space position on the given floor for `painter-viewport.ts` to
 * project to a screen-space fraction.
 */

import type { PropDocument } from '@threemaker/map-format';

export interface PropOverlayPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Every prop marker on `floorId` (props may share a tile, so this is a list, never a single point like spawn). */
export function computePropOverlayPoints(
  props: readonly PropDocument[],
  floorId: string,
): readonly PropOverlayPoint[] {
  return props
    .filter((prop) => prop.floor === floorId)
    .map((prop) => ({ id: prop.id, x: prop.x, y: prop.y }));
}
