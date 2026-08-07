/**
 * Painter trigger-placement authoring overlay (c1a follow-up). Pure -- mirrors
 * `prop-overlay.ts`/`npc-overlay.ts`: exposes each trigger's tile-space
 * position on the given floor for `painter-viewport.ts` to project to a
 * screen-space fraction.
 */

import type { TriggerDocument } from '@threemaker/map-format';

export interface TriggerOverlayPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Every trigger marker on `floorId` (triggers may share a tile; this is a list). */
export function computeTriggerOverlayPoints(
  triggers: readonly TriggerDocument[],
  floorId: string,
): readonly TriggerOverlayPoint[] {
  return triggers
    .filter((trigger) => trigger.floor === floorId)
    .map((trigger) => ({ id: trigger.id, x: trigger.x, y: trigger.y }));
}
