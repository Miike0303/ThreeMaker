import { describe, expect, it } from 'vitest';
import {
  mergeStampStairLinks,
  pickAdjacentFloorIndex,
  roomLandingTile,
  stampStairLinkBetween,
} from '../src/procgen/stairs-from-stamp.js';

describe('pickAdjacentFloorIndex', () => {
  it('prefers the floor below when target is not ground', () => {
    expect(pickAdjacentFloorIndex(2, 3)).toBe(1);
    expect(pickAdjacentFloorIndex(1, 2)).toBe(0);
  });

  it('links ground up when an upper floor exists', () => {
    expect(pickAdjacentFloorIndex(0, 2)).toBe(1);
  });

  it('returns undefined for single-floor or out-of-range', () => {
    expect(pickAdjacentFloorIndex(0, 1)).toBeUndefined();
    expect(pickAdjacentFloorIndex(-1, 2)).toBeUndefined();
    expect(pickAdjacentFloorIndex(2, 2)).toBeUndefined();
  });
});

describe('roomLandingTile', () => {
  it('uses the largest room center on the floor', () => {
    const rooms = [
      {
        id: 'small',
        floor: 'floor-0',
        rects: [{ x: 0, y: 0, width: 2, height: 2 }],
      },
      {
        id: 'big',
        floor: 'floor-0',
        rects: [{ x: 4, y: 6, width: 6, height: 4 }],
      },
      {
        id: 'other',
        floor: 'floor-1',
        rects: [{ x: 0, y: 0, width: 10, height: 10 }],
      },
    ];
    expect(roomLandingTile(rooms, 'floor-0', 20, 20)).toEqual({
      x: 4 + Math.floor(6 / 2),
      y: 6 + Math.floor(4 / 2),
    });
  });

  it('falls back to map center when the floor has no rooms', () => {
    expect(roomLandingTile([], 'floor-1', 10, 8)).toEqual({ x: 5, y: 4 });
  });
});

describe('stampStairLinkBetween', () => {
  it('builds a bidirectional two-waypoint link with stable default id', () => {
    const link = stampStairLinkBetween(
      'floor-1',
      { x: 3, y: 4 },
      'floor-0',
      { x: 5, y: 6 },
    );
    expect(link).toEqual({
      id: 'stamp-stair-floor-1-floor-0',
      fromFloor: 'floor-1',
      toFloor: 'floor-0',
      bidirectional: true,
      waypoints: [
        { x: 3, y: 4, floor: 'floor-1' },
        { x: 5, y: 6, floor: 'floor-0' },
      ],
    });
  });
});

describe('mergeStampStairLinks', () => {
  const a = stampStairLinkBetween('floor-0', { x: 1, y: 1 }, 'floor-1', { x: 2, y: 2 });
  const other = stampStairLinkBetween('floor-1', { x: 0, y: 0 }, 'floor-2', { x: 1, y: 1 });
  const reverse = stampStairLinkBetween('floor-1', { x: 9, y: 9 }, 'floor-0', { x: 8, y: 8 });

  it('replaces either-direction links for the pair and keeps others', () => {
    const next = mergeStampStairLinks([a, other, reverse], 'floor-0', 'floor-1', a);
    expect(next).toEqual([other, a]);
  });

  it('drops the pair when stamp link is undefined', () => {
    expect(mergeStampStairLinks([a, other], 'floor-0', 'floor-1', undefined)).toEqual([other]);
  });
});
