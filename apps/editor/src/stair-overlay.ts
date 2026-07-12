/**
 * Painter stair-link authoring overlay (Slice 5b design: "viewport overlay"
 * for stair-links -- entry/exit markers + a connector cue, a distinct visual
 * from the room-box overlay). Pure -- mirrors `room-overlay.ts`'s shape:
 * selects the stair-link waypoints touching ONE floor and exposes their
 * tile-space position, for `painter-viewport.ts` to project to screen-space
 * fractions the same way `recomputeRoomOverlay`/`recomputeRampGlyphs` do.
 */

import type { StairLinkDocument } from '@threemaker/map-format';

/** Which end of a stair-link the marker represents: `'entry'` is `waypoints[0]` (on `fromFloor`), `'exit'` is the last waypoint (on `toFloor`). A link whose `fromFloor === toFloor` contributes BOTH markers for that one floor. */
export type StairOverlayRole = 'entry' | 'exit';

export interface StairOverlayPoint {
  readonly linkId: string;
  readonly role: StairOverlayRole;
  readonly x: number;
  readonly y: number;
  readonly bidirectional: boolean;
}

/**
 * Every stair-link marker landing on `floorId` -- one entry per side
 * (`fromFloor`/`toFloor`) of every authored link that touches this floor,
 * NOT one per link (a link that both starts and ends conceptually could, in
 * principle, contribute two markers for the same floor -- see
 * `StairOverlayRole`'s doc comment). Order matches `stairLinks`' own order,
 * entry marker before exit marker for a link that touches the floor on
 * both ends.
 */
export function computeStairOverlayPoints(
  stairLinks: readonly StairLinkDocument[],
  floorId: string,
): readonly StairOverlayPoint[] {
  const points: StairOverlayPoint[] = [];
  for (const link of stairLinks) {
    const entry = link.waypoints[0];
    const exit = link.waypoints[link.waypoints.length - 1];
    if (link.fromFloor === floorId && entry) {
      points.push({
        linkId: link.id,
        role: 'entry',
        x: entry.x,
        y: entry.y,
        bidirectional: link.bidirectional,
      });
    }
    if (link.toFloor === floorId && exit) {
      points.push({
        linkId: link.id,
        role: 'exit',
        x: exit.x,
        y: exit.y,
        bidirectional: link.bidirectional,
      });
    }
  }
  return points;
}
