import { describe, expect, it } from 'vitest';
import type { StandabilityQuery } from '../src/spawn.js';
import { findSpawnTile } from '../src/spawn.js';

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
