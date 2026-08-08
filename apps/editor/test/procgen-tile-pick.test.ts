import { describe, expect, it } from 'vitest';
import { majorityNonZeroTileId, resolveDungeonTileIds } from '../src/procgen/tile-pick.js';

describe('majorityNonZeroTileId', () => {
  it('returns undefined for empty/zero layers', () => {
    expect(majorityNonZeroTileId([])).toBeUndefined();
    expect(majorityNonZeroTileId([0, 0, 0])).toBeUndefined();
  });

  it('picks the most frequent non-zero id', () => {
    expect(majorityNonZeroTileId([1, 2, 2, 0, 2, 1])).toBe(2);
  });
});

describe('resolveDungeonTileIds', () => {
  it('prefers brush fill for ground', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 99,
      groundLayer: [1, 1, 1],
      wallLayer: [5, 5],
      fallbackGround: 10,
      fallbackWall: 20,
    });
    expect(r.groundTileId).toBe(99);
    expect(r.wallTileId).toBe(5);
  });

  it('falls back when fill is zero', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 0,
      groundLayer: [3, 3, 0],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
    });
    expect(r.groundTileId).toBe(3);
    expect(r.wallTileId).toBe(20);
  });

  it('avoids wall === ground when fallback differs', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 7,
      groundLayer: [],
      wallLayer: [7, 7],
      fallbackGround: 7,
      fallbackWall: 20,
    });
    expect(r.groundTileId).toBe(7);
    expect(r.wallTileId).toBe(20);
  });
});
