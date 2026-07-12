/**
 * Painter room-box authoring overlay (Slice 5b design: "viewport overlay
 * outlines rooms on the active floor", a distinct visual from the
 * ramp-glyph overlay). Pure -- selects the rooms authored on one floor and
 * exposes each `RoomRect`'s tile-space corners, for `painter-viewport.ts`
 * to project to screen-space fractions the same way `recomputeRampGlyphs`
 * projects a ramp glyph's single point (see `viewer-camera.ts`'s
 * `projectToScreenFraction`).
 */

import type { RoomDocument, RoomRect } from '@threemaker/map-format';

export interface RoomOverlayRect {
  readonly roomId: string;
  readonly roomName?: string;
  readonly rect: RoomRect;
}

/** Every rect belonging to a room authored on `floorId`, flattened one entry per rect -- an L-shaped room (multiple rects) contributes one overlay entry per piece, not one per room. */
export function computeRoomOverlayRects(
  rooms: readonly RoomDocument[],
  floorId: string,
): readonly RoomOverlayRect[] {
  const items: RoomOverlayRect[] = [];
  for (const room of rooms) {
    if (room.floor !== floorId) continue;
    for (const rect of room.rects) {
      items.push(
        room.name !== undefined
          ? { roomId: room.id, roomName: room.name, rect }
          : { roomId: room.id, rect },
      );
    }
  }
  return items;
}

/** The 4 tile-space corners of `rect`'s footprint, in min/min, max/min, max/max, min/max order (`width`/`height` are cell counts, so the far corner sits at `x + width`/`y + height` -- matches `RoomRect`'s own in-bounds validation). The caller projects each corner independently and reduces them to a screen-space bounding box, since the tilted overview camera turns a tile-space rect into a general quadrilateral, not an axis-aligned one. */
export function roomRectCorners(rect: RoomRect): readonly { x: number; y: number }[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}
