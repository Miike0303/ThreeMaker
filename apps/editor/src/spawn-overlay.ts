/**
 * Painter spawn-point authoring overlay (Slice 5b design: "overlay glyph" for
 * the single authored `MapSpawn`). Pure -- mirrors `stair-overlay.ts`/
 * `room-overlay.ts`'s shape: exposes the spawn's tile-space position ONLY
 * when it is authored on the given floor, for `painter-viewport.ts` to
 * project to a screen-space fraction.
 */

import type { MapSpawn } from '@threemaker/map-format';

export interface SpawnOverlayPoint {
  readonly x: number;
  readonly y: number;
}

/** The spawn marker for `floorId`, or `undefined` when unauthored (`spawn` is `undefined`) or authored on a DIFFERENT floor -- a map has at most one spawn, so this is a single point, never a list (unlike `computeStairOverlayPoints`/`computeRoomOverlayRects`). */
export function computeSpawnOverlayPoint(
  spawn: MapSpawn | undefined,
  floorId: string,
): SpawnOverlayPoint | undefined {
  if (!spawn || spawn.floor !== floorId) return undefined;
  return { x: spawn.x, y: spawn.y };
}
