import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { computeHeightGrid, parseMap } from '@threemaker/importer-rpgm';
import { describe, expect, it } from 'vitest';
import {
  computeCliffEdges,
  computeOpenEdges,
  isWallSheet,
  tileKey,
} from '../src/geometry/elevation.js';
import { MZ_PROJECT1_FIXTURE_DIR, requireFixture } from './fixture-path.js';

async function readMz001Map() {
  const contents = await readFile(join(MZ_PROJECT1_FIXTURE_DIR, 'data', 'Map001.json'), 'utf8');
  return parseMap(JSON.parse(contents), 1);
}

describe('isWallSheet', () => {
  it('is true only for A3 and A4 (RPG Maker wall autotile sheets)', () => {
    expect(isWallSheet('A3')).toBe(true);
    expect(isWallSheet('A4')).toBe(true);
    expect(isWallSheet('A1')).toBe(false);
    expect(isWallSheet('A2')).toBe(false);
    expect(isWallSheet('A5')).toBe(false);
    expect(isWallSheet('B')).toBe(false);
  });
});

describe('computeCliffEdges', () => {
  it('returns no edges for a ground-level (height 0) tile', () => {
    const grid = new Uint8Array([0, 0, 0, 0]);
    expect(computeCliffEdges(grid, 2, 2, 0, 0)).toEqual([]);
  });

  it('returns no edges when every neighbor sits at the same height', () => {
    const grid = new Uint8Array([2, 2, 2, 2, 2, 2, 2, 2, 2]); // 3x3, all height 2
    expect(computeCliffEdges(grid, 3, 3, 1, 1)).toEqual([]);
  });

  it('reports a cliff edge toward every neighbor lower than the tile itself', () => {
    // 3x3 grid, center tile (1,1) height 2, all neighbors height 0.
    // biome-ignore format: readability as a grid
    const grid = new Uint8Array([
      0, 0, 0,
      0, 2, 0,
      0, 0, 0,
    ]);
    const edges = computeCliffEdges(grid, 3, 3, 1, 1);

    expect(edges).toHaveLength(4);
    expect(new Set(edges.map((e) => e.edge))).toEqual(new Set(['north', 'south', 'east', 'west']));
    for (const edge of edges) expect(edge.neighborHeight).toBe(0);
  });

  it('treats an off-map neighbor as ground level (a cliff facing the map edge)', () => {
    const grid = new Uint8Array([3]); // 1x1 map, single tile at height 3
    const edges = computeCliffEdges(grid, 1, 1, 0, 0);

    expect(edges).toHaveLength(4);
    for (const edge of edges) expect(edge.neighborHeight).toBe(0);
  });

  it('reproduces the real mz-project1 fixture hill: the peak has cliffs only where the terrace is lower', async () => {
    requireFixture(MZ_PROJECT1_FIXTURE_DIR);
    const map = await readMz001Map();
    const grid = computeHeightGrid(map);

    // Peak tile (11,4), height 3: its north (11,3) and west (10,4) neighbors
    // are the height-2 terrace (lower, so those edges get cliffs); its south
    // (11,5) and east (12,4) neighbors are the other peak cells (same height,
    // no cliff).
    const peakEdges = computeCliffEdges(grid, map.width, map.height, 11, 4);
    expect(new Set(peakEdges.map((e) => e.edge))).toEqual(new Set(['north', 'west']));
    for (const edge of peakEdges) expect(edge.neighborHeight).toBe(2);

    // Ring corner tile (9,2), height 1: north and west neighbors are
    // untouched ground (height 0); south and east are the ring itself
    // (also height 1, same level).
    const ringEdges = computeCliffEdges(grid, map.width, map.height, 9, 2);
    expect(new Set(ringEdges.map((e) => e.edge))).toEqual(new Set(['north', 'west']));
    for (const edge of ringEdges) expect(edge.neighborHeight).toBe(0);

    // Inside-terrace tile (10,4), height 2: its north/south terrace
    // neighbors are also height 2 and its east neighbor is the (higher)
    // peak, so only the west edge -- toward the height-1 ring -- is a cliff.
    const terraceEdges = computeCliffEdges(grid, map.width, map.height, 10, 4);
    expect(terraceEdges).toEqual([{ edge: 'west', neighborHeight: 1 }]);
  });
});

describe('computeOpenEdges', () => {
  it('reports all 4 edges open for an isolated occupant', () => {
    const occupied = new Set([tileKey(5, 5)]);
    const edges = computeOpenEdges(occupied, 5, 5);
    expect(new Set(edges)).toEqual(new Set(['north', 'south', 'east', 'west']));
  });

  it('suppresses only the shared edge between two adjacent occupants (no interior face either side)', () => {
    // Tile A at (2,2), tile B directly east at (3,2).
    const occupied = new Set([tileKey(2, 2), tileKey(3, 2)]);

    const edgesA = computeOpenEdges(occupied, 2, 2);
    expect(edgesA).not.toContain('east');
    expect(new Set(edgesA)).toEqual(new Set(['north', 'south', 'west']));

    const edgesB = computeOpenEdges(occupied, 3, 2);
    expect(edgesB).not.toContain('west');
    expect(new Set(edgesB)).toEqual(new Set(['north', 'south', 'east']));
  });

  it('a tile fully surrounded by occupants on all 4 sides has no open edges', () => {
    const occupied = new Set([
      tileKey(1, 1),
      tileKey(1, 0),
      tileKey(1, 2),
      tileKey(0, 1),
      tileKey(2, 1),
    ]);
    expect(computeOpenEdges(occupied, 1, 1)).toEqual([]);
  });
});
