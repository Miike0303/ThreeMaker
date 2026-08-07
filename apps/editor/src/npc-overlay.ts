/**
 * Painter NPC-placement authoring overlay (c1a follow-up). Pure -- mirrors
 * `prop-overlay.ts`/`spawn-overlay.ts`: exposes each NPC's tile-space
 * position on the given floor for `painter-viewport.ts` to project to a
 * screen-space fraction.
 */

import type { NpcDocument } from '@threemaker/map-format';

export interface NpcOverlayPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Every NPC marker on `floorId` (schema forbids two NPCs on the same base tile per floor). */
export function computeNpcOverlayPoints(
  npcs: readonly NpcDocument[],
  floorId: string,
): readonly NpcOverlayPoint[] {
  return npcs
    .filter((npc) => npc.floor === floorId)
    .map((npc) => ({ id: npc.id, x: npc.x, y: npc.y }));
}
