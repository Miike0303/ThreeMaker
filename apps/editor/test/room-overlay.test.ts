import type { RoomDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { computeRoomOverlayRects, roomRectCorners } from '../src/room-overlay.js';

describe('computeRoomOverlayRects', () => {
  it('flattens every rect of every room authored on the given floor, one entry per rect', () => {
    const rooms: readonly RoomDocument[] = [
      {
        id: 'library',
        name: 'Library',
        floor: 'floor-0',
        rects: [
          { x: 0, y: 0, width: 2, height: 2 },
          { x: 3, y: 0, width: 1, height: 1 },
        ],
      },
    ];

    const items = computeRoomOverlayRects(rooms, 'floor-0');
    expect(items).toEqual([
      { roomId: 'library', roomName: 'Library', rect: { x: 0, y: 0, width: 2, height: 2 } },
      { roomId: 'library', roomName: 'Library', rect: { x: 3, y: 0, width: 1, height: 1 } },
    ]);
  });

  it('omits an entry for a room with no name', () => {
    const rooms: readonly RoomDocument[] = [
      { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
    ];
    const items = computeRoomOverlayRects(rooms, 'floor-0');
    expect(items[0]).toEqual({ roomId: 'room-1', rect: { x: 0, y: 0, width: 1, height: 1 } });
    expect(items[0]).not.toHaveProperty('roomName');
  });

  it('excludes rooms authored on a different floor', () => {
    const rooms: readonly RoomDocument[] = [
      { id: 'ground-room', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
      { id: 'roof-room', floor: 'floor-1', rects: [{ x: 1, y: 1, width: 1, height: 1 }] },
    ];
    const items = computeRoomOverlayRects(rooms, 'floor-0');
    expect(items).toHaveLength(1);
    expect(items[0]?.roomId).toBe('ground-room');
  });

  it('returns an empty array when no room is authored on the given floor', () => {
    expect(computeRoomOverlayRects([], 'floor-0')).toEqual([]);
  });
});

describe('roomRectCorners', () => {
  it('returns the 4 tile-space corners in min/min, max/min, max/max, min/max order', () => {
    const corners = roomRectCorners({ x: 2, y: 3, width: 4, height: 5 });
    expect(corners).toEqual([
      { x: 2, y: 3 },
      { x: 6, y: 3 },
      { x: 6, y: 8 },
      { x: 2, y: 8 },
    ]);
  });

  it('collapses to a single point for a degenerate zero-size rect', () => {
    const corners = roomRectCorners({ x: 5, y: 5, width: 0, height: 0 });
    expect(corners).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
  });
});
