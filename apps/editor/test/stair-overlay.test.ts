import type { StairLinkDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { computeStairOverlayPoints } from '../src/stair-overlay.js';

describe('computeStairOverlayPoints', () => {
  const links: readonly StairLinkDocument[] = [
    {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      bidirectional: true,
      waypoints: [
        { x: 2, y: 3, floor: 'floor-0' },
        { x: 0, y: 0, floor: 'floor-1' },
      ],
    },
    {
      id: 'stair-2',
      fromFloor: 'floor-1',
      toFloor: 'floor-2',
      bidirectional: false,
      waypoints: [
        { x: 5, y: 5, floor: 'floor-1' },
        { x: 1, y: 1, floor: 'floor-2' },
      ],
    },
  ];

  it('emits the entry marker for a link whose fromFloor is the given floor', () => {
    const points = computeStairOverlayPoints(links, 'floor-0');
    expect(points).toEqual([{ linkId: 'stair-1', role: 'entry', x: 2, y: 3, bidirectional: true }]);
  });

  it('emits BOTH the exit marker (as toFloor) and the entry marker (as fromFloor) for a floor sitting in the middle of two links', () => {
    const points = computeStairOverlayPoints(links, 'floor-1');
    expect(points).toEqual(
      expect.arrayContaining([
        { linkId: 'stair-1', role: 'exit', x: 0, y: 0, bidirectional: true },
        { linkId: 'stair-2', role: 'entry', x: 5, y: 5, bidirectional: false },
      ]),
    );
    expect(points).toHaveLength(2);
  });

  it('emits the exit marker for the terminal floor', () => {
    const points = computeStairOverlayPoints(links, 'floor-2');
    expect(points).toEqual([{ linkId: 'stair-2', role: 'exit', x: 1, y: 1, bidirectional: false }]);
  });

  it('returns an empty array for a floor with no stair-link waypoints', () => {
    expect(computeStairOverlayPoints(links, 'floor-9')).toEqual([]);
  });

  it('returns an empty array for an empty stairLinks list', () => {
    expect(computeStairOverlayPoints([], 'floor-0')).toEqual([]);
  });
});
