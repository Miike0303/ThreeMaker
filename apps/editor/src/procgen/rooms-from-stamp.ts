/**
 * Convert procgen stamp rooms into MapDocument RoomDocument entries (pure).
 */
import type { RoomDocument } from '@threemaker/map-format';
import type { DungeonRoom } from './dungeon-stamp.js';

/**
 * One RoomDocument per stamp room: single rect, stable procgen ids.
 * Empty input → empty list (caller may clear floor-0 rooms).
 */
export function roomsFromDungeonStamp(
  rooms: readonly DungeonRoom[],
  floorId: string,
): readonly RoomDocument[] {
  return rooms.map((room, index) => ({
    id: `procgen-room-${index + 1}`,
    name: `Room ${index + 1}`,
    floor: floorId,
    rects: [
      {
        x: room.x,
        y: room.y,
        width: room.w,
        height: room.h,
      },
    ],
  }));
}
