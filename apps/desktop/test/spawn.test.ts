import { describe, expect, it } from 'vitest';
import type { StandabilityQuery } from '../src/spawn.js';
import { findSpawnTile, resolveInitialSpawn } from '../src/spawn.js';

/**
 * Builds a fake grid from an ASCII map: '.' standable, '#' blocked.
 * `isGoodSpawnCandidate` is a simplified proxy matching
 * `@threemaker/gameplay`'s `PassabilityGrid.isGoodSpawnCandidate` intent
 * (standable AND has an adjacent standable neighbor) -- this fixture has no
 * directional/elevation nuance to model, so "any orthogonal neighbor is
 * standable" is the correct simplification, same as `isStandable` itself
 * already simplifies away directional bits.
 */
function fakeGrid(rows: readonly string[]): StandabilityQuery {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  function isStandable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return rows[y]?.[x] === '.';
  }
  return {
    width,
    height,
    isStandable,
    isGoodSpawnCandidate(x: number, y: number): boolean {
      if (!isStandable(x, y)) return false;
      return (
        isStandable(x + 1, y) ||
        isStandable(x - 1, y) ||
        isStandable(x, y + 1) ||
        isStandable(x, y - 1)
      );
    },
  };
}

describe('findSpawnTile', () => {
  it('returns the origin itself when it is already standable', () => {
    const grid = fakeGrid(['...', '...', '...']);
    expect(findSpawnTile(grid, 1, 1)).toEqual({ x: 1, y: 1 });
  });

  it('finds the nearest standable tile when the origin is blocked', () => {
    const grid = fakeGrid(['...', '.#.', '...']);
    // Center (1,1) is blocked and every radius-1 tile is open. ringOffsets
    // emits the top edge first, left-to-right, so (0,0) -- the ring's
    // top-left corner -- wins deterministically.
    expect(findSpawnTile(grid, 1, 1)).toEqual({ x: 0, y: 0 });
  });

  it('expands outward until it finds a standable tile several rings away', () => {
    // Two adjacent open tiles ((2,2) and (3,2)) rather than one isolated
    // dot: findSpawnTile now requires a GOOD spawn candidate (standable
    // with a usable exit, spawn-quality bug fix), so the target tile needs
    // a standable neighbor -- (2,2) is still the nearer/first-found one.
    const grid = fakeGrid(['#####', '#####', '##..#', '#####', '#####']);
    expect(findSpawnTile(grid, 0, 0)).toEqual({ x: 2, y: 2 });
  });

  it('rounds a fractional origin to the nearest tile', () => {
    const grid = fakeGrid(['...', '...', '...']);
    expect(findSpawnTile(grid, 1.4, 0.6)).toEqual({ x: 1, y: 1 });
  });

  it('ignores out-of-bounds ring candidates near the map edge', () => {
    // (0,0) needs a standable neighbor to qualify under the strengthened
    // predicate; (1,0) being open too doesn't change which candidate is
    // found first (still (0,0), per ringOffsets' emission order) or the
    // out-of-bounds-skipping this test exists to cover.
    const grid = fakeGrid(['..', '##']);
    expect(findSpawnTile(grid, 1, 1)).toEqual({ x: 0, y: 0 });
  });

  it('throws when the entire map has no standable tile', () => {
    const grid = fakeGrid(['##', '##']);
    expect(() => findSpawnTile(grid, 0, 0)).toThrow(/no standable tile/i);
  });
});

describe('resolveInitialSpawn', () => {
  const floor0 = fakeGrid(['...', '...', '.#.']);
  const floor1 = fakeGrid(['...', '.#.', '...']);

  it('honors an authored spawn when its floor exists and the tile is standable there', () => {
    const result = resolveInitialSpawn([floor0, floor1], { x: 0, y: 1, floorIndex: 1 }, 1, 1);
    expect(result).toEqual({ x: 0, y: 1, floorIndex: 1 });
  });

  it('falls back to findSpawnTile on the SAME authored floor when the authored tile is not standable', () => {
    // (1,1) is blocked on floor1; nearest standable ring-1 tile is (0,0).
    const result = resolveInitialSpawn([floor0, floor1], { x: 1, y: 1, floorIndex: 1 }, 1, 1);
    expect(result).toEqual({ x: 0, y: 0, floorIndex: 1 });
  });

  it('falls back to floor 0 when the authored floorIndex does not exist', () => {
    const result = resolveInitialSpawn([floor0, floor1], { x: 0, y: 0, floorIndex: 7 }, 1, 1);
    expect(result).toEqual({ x: 1, y: 1, floorIndex: 0 });
  });

  it('rejects an authored spawn that is standable but fully enclosed (no standable neighbor), falling back to findSpawnTile (spawn-quality bug fix: "spawns in a wall")', () => {
    // (2,0) is standable by itself but every neighbor is a wall; the real
    // open area is rows 2-3. Origin (2,2) sits directly in that open area,
    // so findSpawnTile's fallback resolves there on the very first check.
    const enclosedFloor = fakeGrid(['##.##', '#####', '.....', '.....']);
    const result = resolveInitialSpawn([enclosedFloor], { x: 2, y: 0, floorIndex: 0 }, 2, 2);
    expect(result).toEqual({ x: 2, y: 2, floorIndex: 0 });
  });

  it('falls back to floor 0 when no spawn was authored at all', () => {
    const result = resolveInitialSpawn([floor0, floor1], undefined, 1, 1);
    expect(result).toEqual({ x: 1, y: 1, floorIndex: 0 });
  });
});
