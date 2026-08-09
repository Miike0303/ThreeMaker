import { describe, expect, it } from 'vitest';
import { createBlankMapDocument } from '../src/map-compose.js';
import { applyDungeonStampToMapDocument } from '../src/procgen/apply-stamp.js';
import { stampSimpleDungeon } from '../src/procgen/dungeon-stamp.js';
import { roomsFromDungeonStamp } from '../src/procgen/rooms-from-stamp.js';

describe('roomsFromDungeonStamp', () => {
  it('maps stamp rooms to RoomDocument rects on the given floor', () => {
    const rooms = roomsFromDungeonStamp(
      [
        { x: 2, y: 3, w: 5, h: 4 },
        { x: 10, y: 1, w: 6, h: 6 },
      ],
      'floor-0',
    );
    expect(rooms).toEqual([
      {
        id: 'procgen-room-1',
        name: 'Room 1',
        floor: 'floor-0',
        rects: [{ x: 2, y: 3, width: 5, height: 4 }],
      },
      {
        id: 'procgen-room-2',
        name: 'Room 2',
        floor: 'floor-0',
        rects: [{ x: 10, y: 1, width: 6, height: 6 }],
      },
    ]);
  });

  it('returns empty when no rooms were placed', () => {
    expect(roomsFromDungeonStamp([], 'floor-0')).toEqual([]);
  });
});

describe('applyDungeonStampToMapDocument replaceFloor0Rooms', () => {
  it('replaces floor-0 rooms and keeps other floors when requested', () => {
    const base = createBlankMapDocument({
      id: 'rooms-stamp',
      name: 'Rooms',
      width: 24,
      height: 18,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const doc = {
      ...base,
      rooms: [
        {
          id: 'old-0',
          floor: 'floor-0',
          rects: [{ x: 0, y: 0, width: 2, height: 2 }],
        },
        {
          id: 'keep-1',
          floor: 'floor-other',
          rects: [{ x: 1, y: 1, width: 3, height: 3 }],
        },
      ],
    };
    const stamp = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 42,
      groundTileId: 2816,
      wallTileId: 4352,
      roomCount: 4,
    });
    expect(stamp.rooms.length).toBeGreaterThan(0);
    const next = applyDungeonStampToMapDocument(doc, stamp, {
      replaceFloor0Rooms: true,
    });
    expect(next.rooms.some((r) => r.id === 'old-0')).toBe(false);
    expect(next.rooms.find((r) => r.id === 'keep-1')).toEqual(doc.rooms[1]);
    const floor0Rooms = next.rooms.filter((r) => r.floor === 'floor-0');
    expect(floor0Rooms).toHaveLength(stamp.rooms.length);
    expect(floor0Rooms[0]?.rects[0]).toEqual({
      x: stamp.rooms[0]!.x,
      y: stamp.rooms[0]!.y,
      width: stamp.rooms[0]!.w,
      height: stamp.rooms[0]!.h,
    });
  });

  it('preserves document rooms when replaceFloor0Rooms is omitted', () => {
    const base = createBlankMapDocument({
      id: 'rooms-keep',
      name: 'Keep',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const doc = {
      ...base,
      rooms: [
        {
          id: 'authored',
          floor: 'floor-0',
          rects: [{ x: 1, y: 1, width: 4, height: 4 }],
        },
      ],
    };
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 1,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp);
    expect(next.rooms).toEqual(doc.rooms);
  });
});
