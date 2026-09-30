import { describe, expect, it } from 'vitest';
import {
  countStampStairLinks,
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

  it('rejects fractional floor counts even with an integer target index', () => {
    expect(pickAdjacentFloorIndex(0, 2.5)).toBeUndefined();
  });

  it('rejects fractional target floor indexes', () => {
    expect(pickAdjacentFloorIndex(1.5, 3)).toBeUndefined();
  });
});

describe('roomLandingTile', () => {
  it('selects the largest landing room after filtering out preceding floors', () => {
    const rooms = [
      {
        id: 'lower-hall',
        floor: 'floor-0',
        rects: [{ x: 0, y: 0, width: 14, height: 10 }],
      },
      {
        id: 'upper-small',
        floor: 'floor-1',
        rects: [{ x: 1, y: 1, width: 2, height: 2 }],
      },
      {
        id: 'upper-largest',
        floor: 'floor-1',
        rects: [{ x: 8, y: 4, width: 6, height: 4 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-1', 20, 12)).toEqual({ x: 11, y: 6 });
  });

  it('uses the center column for a two-column map without landing rooms', () => {
    expect(roomLandingTile([], 'floor-1', 2, 8)).toEqual({ x: 1, y: 4 });
  });

  it('uses the center row for a two-row map without landing rooms', () => {
    expect(roomLandingTile([], 'floor-1', 10, 2)).toEqual({ x: 5, y: 1 });
  });

  it('falls back to map center when the landing room has no rectangles', () => {
    const rooms = [{ id: 'empty-room', floor: 'floor-1', rects: [] }];

    expect(roomLandingTile(rooms, 'floor-1', 10, 8)).toEqual({ x: 5, y: 4 });
  });

  it('centers the fallback stair landing on a map wider than twice its height', () => {
    expect(roomLandingTile([], 'floor-1', 32, 8)).toEqual({ x: 16, y: 4 });
  });

  it('centers the fallback stair landing on a map taller than twice its width', () => {
    expect(roomLandingTile([], 'floor-1', 8, 32)).toEqual({ x: 4, y: 16 });
  });

  it('clamps a room landing west of the map to column zero', () => {
    const rooms = [
      {
        id: 'west-room',
        floor: 'floor-0',
        rects: [{ x: -4, y: 1, width: 4, height: 4 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-0', 10, 8)).toEqual({ x: 0, y: 3 });
  });

  it('clamps a room landing north of the map to row zero', () => {
    const rooms = [
      {
        id: 'north-room',
        floor: 'floor-0',
        rects: [{ x: 1, y: -4, width: 4, height: 4 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-0', 10, 8)).toEqual({ x: 3, y: 0 });
  });

  it('falls back to map center when rooms exist only on a lower floor', () => {
    const rooms = [
      {
        id: 'lower-room',
        floor: 'floor-0',
        rects: [{ x: 0, y: 0, width: 2, height: 2 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-1', 10, 8)).toEqual({ x: 5, y: 4 });
  });

  it('selects the largest landing room without accumulating earlier areas', () => {
    const rooms = [
      {
        id: 'small',
        floor: 'floor-0',
        rects: [{ x: 1, y: 1, width: 2, height: 2 }],
      },
      {
        id: 'medium',
        floor: 'floor-0',
        rects: [{ x: 5, y: 1, width: 3, height: 3 }],
      },
      {
        id: 'largest',
        floor: 'floor-0',
        rects: [{ x: 10, y: 1, width: 4, height: 3 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-0', 20, 10)).toEqual({ x: 12, y: 2 });
  });

  it('keeps the largest landing room when a later room only exceeds the first', () => {
    const rooms = [
      {
        id: 'small',
        floor: 'floor-0',
        rects: [{ x: 0, y: 0, width: 2, height: 2 }],
      },
      {
        id: 'largest',
        floor: 'floor-0',
        rects: [{ x: 4, y: 2, width: 4, height: 4 }],
      },
      {
        id: 'medium',
        floor: 'floor-0',
        rects: [{ x: 10, y: 6, width: 3, height: 3 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-0', 16, 12)).toEqual({ x: 6, y: 4 });
  });

  it('keeps a first-column room landing on column zero', () => {
    const rooms = [
      {
        id: 'first-column-room',
        floor: 'floor-0',
        rects: [{ x: 0, y: 1, width: 1, height: 4 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-0', 10, 8)).toEqual({ x: 0, y: 3 });
  });

  it('clamps a room landing beyond the south edge to the last row', () => {
    const rooms = [
      {
        id: 'south-room',
        floor: 'floor-0',
        rects: [{ x: 1, y: 7, width: 4, height: 4 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-0', 10, 8)).toEqual({ x: 3, y: 7 });
  });

  it('keeps a first-row room landing on row zero', () => {
    const rooms = [
      {
        id: 'first-row-room',
        floor: 'floor-0',
        rects: [{ x: 1, y: 0, width: 4, height: 1 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-0', 10, 8)).toEqual({ x: 3, y: 0 });
  });

  it('clamps a room landing beyond the east edge to the last column', () => {
    const rooms = [
      {
        id: 'clipped-room',
        floor: 'floor-0',
        rects: [{ x: 9, y: 1, width: 4, height: 4 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-0', 10, 8)).toEqual({ x: 9, y: 3 });
  });

  it('uses the center tile of an odd-sized map when the landing floor has no rooms', () => {
    expect(roomLandingTile([], 'floor-1', 9, 7)).toEqual({ x: 4, y: 3 });
  });

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

  it('keeps the first largest room as the stair landing when areas tie', () => {
    const rooms = [
      {
        id: 'first',
        floor: 'floor-0',
        rects: [{ x: 1, y: 1, width: 4, height: 4 }],
      },
      {
        id: 'second',
        floor: 'floor-0',
        rects: [{ x: 10, y: 6, width: 8, height: 2 }],
      },
    ];

    expect(roomLandingTile(rooms, 'floor-0', 20, 12)).toEqual({ x: 3, y: 3 });
  });

  it('falls back to map center when the floor has no rooms', () => {
    expect(roomLandingTile([], 'floor-1', 10, 8)).toEqual({ x: 5, y: 4 });
  });
});

describe('stampStairLinkBetween', () => {
  it('builds a bidirectional two-waypoint link with stable default id', () => {
    const link = stampStairLinkBetween('floor-1', { x: 3, y: 4 }, 'floor-0', { x: 5, y: 6 });
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

  it('keeps a blank stair id instead of substituting the generated prefix', () => {
    const link = stampStairLinkBetween(
      'floor-1',
      { x: 3, y: 4 },
      'floor-0',
      { x: 5, y: 6 },
      { id: '' },
    );
    expect(link.id).toBe('');
  });

  it('honors an explicitly one-way stair link', () => {
    const link = stampStairLinkBetween(
      'floor-0',
      { x: 1, y: 1 },
      'floor-1',
      { x: 2, y: 2 },
      { bidirectional: false },
    );
    expect(link.bidirectional).toBe(false);
  });
});

describe('mergeStampStairLinks', () => {
  const a = stampStairLinkBetween('floor-0', { x: 1, y: 1 }, 'floor-1', { x: 2, y: 2 });
  const other = stampStairLinkBetween('floor-1', { x: 0, y: 0 }, 'floor-2', { x: 1, y: 1 });
  const reverse = stampStairLinkBetween('floor-1', { x: 9, y: 9 }, 'floor-0', { x: 8, y: 8 });
  const authored = { ...a, id: 'hand-drawn' };
  const isStandable = (x: number, y: number) => x === 1 && y === 1;

  it('keeps generated stairs from a third floor into the pair destination', () => {
    const unrelated = stampStairLinkBetween('floor-2', { x: 2, y: 2 }, 'floor-1', {
      x: 1,
      y: 1,
    });

    expect(
      mergeStampStairLinks([unrelated], 'floor-0', 'floor-1', a, 'floor-0', () => false),
    ).toEqual([unrelated, a]);
  });

  it('keeps generated stairs from a third floor into the pair source', () => {
    const unrelated = stampStairLinkBetween('floor-2', { x: 2, y: 2 }, 'floor-0', {
      x: 1,
      y: 1,
    });

    expect(
      mergeStampStairLinks([unrelated], 'floor-0', 'floor-1', a, 'floor-0', () => false),
    ).toEqual([unrelated, a]);
  });

  it('keeps generated stairs from the reverse pair source to a third floor', () => {
    const unrelated = stampStairLinkBetween('floor-2', { x: 2, y: 2 }, 'floor-0', {
      x: 1,
      y: 1,
    });

    expect(
      mergeStampStairLinks([unrelated], 'floor-1', 'floor-2', other, 'floor-1', () => false),
    ).toEqual([unrelated, other]);
  });

  it('keeps generated lower-floor stairs when stamping a different upper-floor pair', () => {
    const next = mergeStampStairLinks(
      [reverse],
      'floor-1',
      'floor-2',
      other,
      'floor-1',
      () => false,
    );

    expect(next).toEqual([reverse, other]);
  });

  it('drops an authored stair blocked on the second floor in the pair', () => {
    expect(
      mergeStampStairLinks([authored], 'floor-0', 'floor-1', a, 'floor-1', isStandable),
    ).toEqual([a]);
  });

  it('keeps an authored stair whose id contains the generated prefix after other text', () => {
    const named = { ...authored, id: 'hand-stamp-stair-annex' };

    expect(mergeStampStairLinks([named], 'floor-0', 'floor-1', a, 'floor-0', isStandable)).toEqual([
      named,
      a,
    ]);
  });

  it('replaces generated links in either direction and keeps authored and other pairs', () => {
    const next = mergeStampStairLinks(
      [a, authored, other, reverse],
      'floor-0',
      'floor-1',
      a,
      'floor-0',
      isStandable,
    );
    expect(next).toEqual([authored, other, a]);
  });

  it('removes generated pair links when stamp link is undefined', () => {
    expect(
      mergeStampStairLinks(
        [a, authored, other],
        'floor-0',
        'floor-1',
        undefined,
        'floor-0',
        isStandable,
      ),
    ).toEqual([authored, other]);
  });

  it('keeps an authored pair link on standable stamped-floor cells', () => {
    expect(
      mergeStampStairLinks([authored], 'floor-0', 'floor-1', a, 'floor-0', isStandable),
    ).toEqual([authored, a]);
  });

  it('drops an authored pair link with a non-standable stamped-floor waypoint', () => {
    const blocked = {
      ...authored,
      waypoints: [{ x: 0, y: 0, floor: 'floor-0' }, ...authored.waypoints],
    };
    expect(
      mergeStampStairLinks([blocked], 'floor-0', 'floor-1', a, 'floor-0', isStandable),
    ).toEqual([a]);
  });

  it('replaces a stamp-prefixed pair link even when its landing is standable', () => {
    expect(
      mergeStampStairLinks([a], 'floor-0', 'floor-1', reverse, 'floor-0', isStandable),
    ).toEqual([reverse]);
  });

  it('keeps links for other floor pairs without checking their waypoints', () => {
    expect(mergeStampStairLinks([other], 'floor-0', 'floor-1', a, 'floor-0', () => false)).toEqual([
      other,
      a,
    ]);
  });
});

describe('countStampStairLinks (WU-PROC-19)', () => {
  it('does not count an authored staircase ID without the generated prefix delimiter', () => {
    const authored = stampStairLinkBetween(
      'floor-0',
      { x: 1, y: 1 },
      'floor-1',
      { x: 2, y: 2 },
      { id: 'stamp-staircase-main' },
    );

    expect(countStampStairLinks([authored])).toBe(0);
  });

  it('does not count authored stair ids containing the generated prefix', () => {
    const authored = stampStairLinkBetween(
      'floor-0',
      { x: 1, y: 1 },
      'floor-1',
      { x: 2, y: 2 },
      { id: 'hand-stamp-stair-annex' },
    );

    expect(countStampStairLinks([authored])).toBe(0);
  });

  it('counts only stamp-prefixed stair ids', () => {
    const stamp = stampStairLinkBetween('floor-1', { x: 1, y: 1 }, 'floor-0', { x: 2, y: 2 });
    const authored = {
      id: 'hand-drawn',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      bidirectional: true,
      waypoints: [
        { x: 0, y: 0, floor: 'floor-0' },
        { x: 1, y: 1, floor: 'floor-1' },
      ],
    };
    expect(
      countStampStairLinks([
        stamp,
        authored,
        stampStairLinkBetween('a', { x: 0, y: 0 }, 'b', { x: 1, y: 1 }),
      ]),
    ).toBe(2);
    expect(countStampStairLinks([])).toBe(0);
    expect(countStampStairLinks([authored])).toBe(0);
  });
});
