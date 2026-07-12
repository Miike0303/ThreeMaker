import { describe, expect, it } from 'vitest';
import type { StandabilityQuery } from '../src/spawn.js';
import { findSpawnTile, resolveInitialSpawn } from '../src/spawn.js';

/** Builds a fake grid from an ASCII map: '.' standable, '#' blocked. */
function fakeGrid(rows: readonly string[]): StandabilityQuery {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return {
    width,
    height,
    isStandable(x: number, y: number): boolean {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return rows[y]?.[x] === '.';
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
    const grid = fakeGrid(['#####', '#####', '##.##', '#####', '#####']);
    expect(findSpawnTile(grid, 0, 0)).toEqual({ x: 2, y: 2 });
  });

  it('rounds a fractional origin to the nearest tile', () => {
    const grid = fakeGrid(['...', '...', '...']);
    expect(findSpawnTile(grid, 1.4, 0.6)).toEqual({ x: 1, y: 1 });
  });

  it('ignores out-of-bounds ring candidates near the map edge', () => {
    const grid = fakeGrid(['.#', '##']);
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

  it('falls back to floor 0 when no spawn was authored at all', () => {
    const result = resolveInitialSpawn([floor0, floor1], undefined, 1, 1);
    expect(result).toEqual({ x: 1, y: 1, floorIndex: 0 });
  });
});
