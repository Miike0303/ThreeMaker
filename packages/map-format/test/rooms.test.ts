/**
 * `computeRoomIdGrid` (techos-y-oclusion-interiores Slice 1): pure per-floor
 * room-id grid, mirroring `@threemaker/importer-rpgm`'s `computeHeightGrid`
 * shape (design: "computeRoomIdGrid home"). `0` = unauthored (spec:
 * "Unauthored cell defaults" / locked decision: unauthored areas never
 * occlude); a non-zero cell is the 1-based ordinal (in the floor's own
 * document-order subset of `rooms`) of the room occupying that cell, with a
 * later room in document order winning on overlap.
 */
import { describe, expect, it } from 'vitest';
import { computeRoomIdGrid } from '../src/rooms.js';
import type { RoomDocument } from '../src/schema.js';

describe('computeRoomIdGrid', () => {
  it('returns an all-zero grid when there are no rooms (spec: Unauthored cell defaults)', () => {
    const grid = computeRoomIdGrid([], 'floor-0', 3, 2);
    expect(grid).toBeInstanceOf(Uint16Array);
    expect(grid.length).toBe(6);
    expect(Array.from(grid)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('returns an all-zero grid when no room targets this floor (floor-scoping)', () => {
    const rooms: readonly RoomDocument[] = [
      { id: 'room-1', floor: 'floor-1', rects: [{ x: 0, y: 0, width: 2, height: 2 }] },
    ];
    const grid = computeRoomIdGrid(rooms, 'floor-0', 2, 2);
    expect(Array.from(grid)).toEqual([0, 0, 0, 0]);
  });

  it('assigns the 1-based ordinal of the floor-scoped room to its footprint cells', () => {
    const rooms: readonly RoomDocument[] = [
      { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
    ];
    const grid = computeRoomIdGrid(rooms, 'floor-0', 2, 2);
    // Row-major: (0,0) -> index 0.
    expect(Array.from(grid)).toEqual([1, 0, 0, 0]);
  });

  it('a room with multiple rects paints every rect with the same room id', () => {
    const rooms: readonly RoomDocument[] = [
      {
        id: 'l-room',
        floor: 'floor-0',
        rects: [
          { x: 0, y: 0, width: 1, height: 1 },
          { x: 2, y: 2, width: 1, height: 1 },
        ],
      },
    ];
    const grid = computeRoomIdGrid(rooms, 'floor-0', 3, 3);
    expect(grid[0 * 3 + 0]).toBe(1);
    expect(grid[2 * 3 + 2]).toBe(1);
    expect(grid[1 * 3 + 1]).toBe(0);
  });

  it('scopes room ordinals to only the rooms on the requested floor, in document order', () => {
    const rooms: readonly RoomDocument[] = [
      { id: 'other-floor-room', floor: 'floor-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
      { id: 'first-on-floor-0', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
      { id: 'second-on-floor-0', floor: 'floor-0', rects: [{ x: 1, y: 0, width: 1, height: 1 }] },
    ];
    const grid = computeRoomIdGrid(rooms, 'floor-0', 2, 1);
    // "first-on-floor-0" and "second-on-floor-0" are ordinals 1 and 2 within
    // floor-0's OWN subset -- the floor-1 room does not consume an ordinal.
    expect(Array.from(grid)).toEqual([1, 2]);
  });

  it('later room in document order wins on overlap', () => {
    const rooms: readonly RoomDocument[] = [
      { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 2, height: 1 }] },
      { id: 'room-2', floor: 'floor-0', rects: [{ x: 1, y: 0, width: 1, height: 1 }] },
    ];
    const grid = computeRoomIdGrid(rooms, 'floor-0', 2, 1);
    // Cell (0,0) only belongs to room-1 (ordinal 1); cell (1,0) is claimed by
    // both, and room-2 (ordinal 2, later in document order) wins.
    expect(Array.from(grid)).toEqual([1, 2]);
  });
});
