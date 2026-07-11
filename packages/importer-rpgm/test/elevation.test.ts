import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeHeightGrid,
  computeRampGrid,
  edgeProfileAt,
  heightForRegion,
  profilesEqual,
  type RampCellInput,
  surfaceHeightAt,
} from '../src/elevation.js';
import { parseMap } from '../src/parse-map.js';
import type { RpgmMap } from '../src/types.js';
import { MZ_PROJECT1_FIXTURE_DIR, requireFixture } from './fixture-path.js';

async function readJson(fileName: string): Promise<unknown> {
  const contents = await readFile(join(MZ_PROJECT1_FIXTURE_DIR, 'data', fileName), 'utf8');
  return JSON.parse(contents);
}

function buildMap(width: number, height: number, regions: readonly number[]): RpgmMap {
  const size = width * height;
  const empty = new Array(size).fill(0);
  return {
    id: 1,
    displayName: 'synthetic',
    width,
    height,
    tilesetId: 1,
    scrollType: 0,
    layers: {
      tileLayers: [empty, empty, empty, empty],
      shadows: empty,
      regions,
    },
  };
}

describe('heightForRegion', () => {
  it('maps region ids 1-7 to the same height, per the MV3D convention', () => {
    for (let region = 1; region <= 7; region++) {
      expect(heightForRegion(region)).toBe(region);
    }
  });

  it('treats region 0 (unpainted) as ground level', () => {
    expect(heightForRegion(0)).toBe(0);
  });

  it('treats region ids outside 1-7 (free-form plugin regions) as ground level', () => {
    expect(heightForRegion(8)).toBe(0);
    expect(heightForRegion(63)).toBe(0);
    expect(heightForRegion(255)).toBe(0);
  });
});

describe('computeHeightGrid', () => {
  it('produces a row-major grid matching heightForRegion for every cell', () => {
    const regions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 200];
    const map = buildMap(10, 1, regions);

    const grid = computeHeightGrid(map);

    expect(Array.from(grid)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 0]);
  });

  it('reproduces the real mz-project1 fixture painted hill (ring=1, inside=2, peak=3)', async () => {
    requireFixture(MZ_PROJECT1_FIXTURE_DIR);
    const map = parseMap(await readJson('Map001.json'), 1);

    const grid = computeHeightGrid(map);
    const at = (x: number, y: number) => grid[y * map.width + x];

    // Outside the painted hill: ground level.
    expect(at(0, 0)).toBe(0);
    expect(at(8, 4)).toBe(0);

    // Ring (region 1): the border of the hill, rows 2-7 cols 9-14.
    expect(at(9, 2)).toBe(1);
    expect(at(14, 7)).toBe(1);

    // Inside the ring (region 2).
    expect(at(10, 3)).toBe(2);
    expect(at(13, 6)).toBe(2);

    // Peak (region 3): rows 4-5, cols 11-12.
    expect(at(11, 4)).toBe(3);
    expect(at(12, 5)).toBe(3);
  });
});

describe('computeRampGrid', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the unique lower neighbor as the downhill direction', () => {
    // 1-wide, 3-tall strip: (0,1) sits at height 2, its only H-1 (=1)
    // neighbor is south (0,2); north (0,0) is also height 2 (not a
    // candidate) and east/west are off-map (=ground=0, diff 2, not 1).
    const mapWidth = 1;
    const mapHeight = 3;
    const heightGrid = new Uint8Array([2, 2, 1]);
    const rampCells: readonly RampCellInput[] = [{ x: 0, y: 1 }];

    const rampGrid = computeRampGrid(mapWidth, mapHeight, heightGrid, rampCells);

    expect(Array.from(rampGrid)).toEqual([0, 2 /* south */, 0]);
  });

  it('applies the south > east > west > north tie-break when 2+ neighbors qualify', () => {
    // 3x3 grid, center (1,1) at height 2. Configure which neighbors sit at
    // height 1 (candidates) per case and confirm the highest-priority one
    // among the ACTUAL candidates wins.
    function heightsWithCenter(candidates: {
      north?: boolean;
      south?: boolean;
      east?: boolean;
      west?: boolean;
    }): Uint8Array {
      const grid = new Uint8Array(9).fill(2);
      const at = (x: number, y: number) => y * 3 + x;
      if (candidates.north) grid[at(1, 0)] = 1;
      if (candidates.south) grid[at(1, 2)] = 1;
      if (candidates.east) grid[at(2, 1)] = 1;
      if (candidates.west) grid[at(0, 1)] = 1;
      return grid;
    }
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 1 }];

    // south + east + west + north all candidates -> south wins.
    expect(
      Array.from(
        computeRampGrid(
          3,
          3,
          heightsWithCenter({ north: true, south: true, east: true, west: true }),
          rampCells,
        ),
      )[4],
    ).toBe(2); // south

    // east + west + north (no south) -> east wins.
    expect(
      Array.from(
        computeRampGrid(
          3,
          3,
          heightsWithCenter({ north: true, east: true, west: true }),
          rampCells,
        ),
      )[4],
    ).toBe(3); // east

    // west + north (no south, no east) -> west wins.
    expect(
      Array.from(
        computeRampGrid(3, 3, heightsWithCenter({ north: true, west: true }), rampCells),
      )[4],
    ).toBe(4); // west
  });

  it('honors an explicit rampDirection override over the tie-break result', () => {
    // Center (1,1) height 2; both east and west sit at height 1, so the
    // auto tie-break (south>east>west>north) would normally pick 'east'.
    // An explicit override of 'west' must win instead.
    const heightGrid = new Uint8Array([2, 2, 2, 1, 2, 1, 2, 2, 2]);
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 1, rampDirection: 'west' }];

    const rampGrid = computeRampGrid(3, 3, heightGrid, rampCells);

    expect(rampGrid[4]).toBe(4); // west, not the tie-break's 'east'
  });

  it('treats a multi-level-span ramp cell as inert (not rejected) and logs a dev warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // (0,0) height 3, its explicit override points south to (0,1) at
    // height 0 -- a 3-level drop, not the single level a ramp supports.
    const heightGrid = new Uint8Array([3, 0]);
    const rampCells: readonly RampCellInput[] = [{ x: 0, y: 0, rampDirection: 'south' }];

    const rampGrid = computeRampGrid(1, 2, heightGrid, rampCells);

    expect(rampGrid[0]).toBe(0); // inert, not rejected -- computeRampGrid never throws
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/multi-level span/i);
  });

  it('leaves a cell inert without warning when no neighbor sits below it at all (flat plateau)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 3x3, all height 2: center (1,1) has all 4 neighbors in-bounds at the
    // SAME height (not off-map, so no phantom ground-level distant drop).
    const heightGrid = new Uint8Array(9).fill(2);
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 1 }];

    const rampGrid = computeRampGrid(3, 3, heightGrid, rampCells);

    expect(rampGrid[4]).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('edgeProfileAt', () => {
  it('returns [H,H] for every edge of a flat (non-ramp) cell', () => {
    const heightGrid = new Uint8Array([2]);
    const rampGrid = new Uint8Array([0]);

    for (const edge of ['north', 'south', 'east', 'west'] as const) {
      expect(edgeProfileAt(heightGrid, rampGrid, 1, 1, 0, 0, edge)).toEqual([2, 2]);
    }
  });

  it('returns ground ([0,0]) for out-of-bounds coordinates', () => {
    const heightGrid = new Uint8Array([5]);
    const rampGrid = new Uint8Array([0]);

    expect(edgeProfileAt(heightGrid, rampGrid, 1, 1, -1, 0, 'east')).toEqual([0, 0]);
    expect(edgeProfileAt(heightGrid, rampGrid, 1, 1, 1, 0, 'west')).toEqual([0, 0]);
    expect(edgeProfileAt(heightGrid, rampGrid, 1, 1, 0, 5, 'north')).toEqual([0, 0]);
  });

  it('gives a ramp cell canonical-order profiles that match its flat neighbor from both perspectives (profilesEqual symmetric)', () => {
    // 1-wide, 2-tall map: (0,0) height 2, ramp direction south; (0,1) is
    // flat at height 1 -- exactly the neighbor the ramp descends to.
    const mapWidth = 1;
    const mapHeight = 2;
    const heightGrid = new Uint8Array([2, 1]);
    const rampGrid = computeRampGrid(mapWidth, mapHeight, heightGrid, [{ x: 0, y: 0 }]);
    expect(rampGrid[0]).toBe(2); // south, auto-derived (unique candidate)

    // Ramp cell's own south edge (its downhill edge) sits at H-1 = 1.
    const rampSouthEdge = edgeProfileAt(heightGrid, rampGrid, mapWidth, mapHeight, 0, 0, 'south');
    expect(rampSouthEdge).toEqual([1, 1]);

    // Neighbor's north edge, from ITS OWN perspective (flat, height 1).
    const neighborNorthEdge = edgeProfileAt(
      heightGrid,
      rampGrid,
      mapWidth,
      mapHeight,
      0,
      1,
      'north',
    );
    expect(neighborNorthEdge).toEqual([1, 1]);

    // Same shared edge, computed from both sides: equal -> the step is open.
    expect(profilesEqual(rampSouthEdge, neighborNorthEdge)).toBe(true);

    // The ramp's own north (uphill, opposite) edge stays at its own height.
    const rampNorthEdge = edgeProfileAt(heightGrid, rampGrid, mapWidth, mapHeight, 0, 0, 'north');
    expect(rampNorthEdge).toEqual([2, 2]);

    // The perpendicular edges slope linearly between the two heights, and
    // (since direction is north/south) both perpendicular edges match.
    const eastEdge = edgeProfileAt(heightGrid, rampGrid, mapWidth, mapHeight, 0, 0, 'east');
    const westEdge = edgeProfileAt(heightGrid, rampGrid, mapWidth, mapHeight, 0, 0, 'west');
    expect(eastEdge).toEqual([2, 1]);
    expect(westEdge).toEqual([2, 1]);
  });
});

describe('profilesEqual', () => {
  it.each([
    [[1, 1] as const, [1, 1] as const, true],
    [[2, 1] as const, [2, 1] as const, true],
    [[2, 1] as const, [1, 2] as const, false],
    [[2, 1] as const, [2, 2] as const, false],
    [[0, 0] as const, [0, 1] as const, false],
  ])('profilesEqual(%o, %o) === %s', (a, b, expected) => {
    expect(profilesEqual(a, b)).toBe(expected);
  });
});

describe('surfaceHeightAt', () => {
  it('returns the constant integer height for a flat map regardless of fractional position', () => {
    const heightGrid = new Uint8Array([3]);
    const rampGrid = new Uint8Array([0]);

    expect(surfaceHeightAt(heightGrid, rampGrid, 1, 1, 0, 0)).toBe(3);
    expect(surfaceHeightAt(heightGrid, rampGrid, 1, 1, 0.25, 0.75)).toBe(3);
    expect(surfaceHeightAt(heightGrid, rampGrid, 1, 1, 0.999, 0.001)).toBe(3);
  });

  it("interpolates linearly across a ramp cell's slope", () => {
    // (0,0) height 2, ramp direction east; (1,0) flat at height 1.
    const mapWidth = 2;
    const mapHeight = 1;
    const heightGrid = new Uint8Array([2, 1]);
    const rampGrid = computeRampGrid(mapWidth, mapHeight, heightGrid, [{ x: 0, y: 0 }]);
    expect(rampGrid[0]).toBe(3); // east, auto-derived

    // Along the ramp's own cell (x in [0,1)): height = 2 - u (u = fx - 0).
    expect(surfaceHeightAt(heightGrid, rampGrid, mapWidth, mapHeight, 0, 0.5)).toBeCloseTo(2);
    expect(surfaceHeightAt(heightGrid, rampGrid, mapWidth, mapHeight, 0.25, 0.5)).toBeCloseTo(1.75);
    expect(surfaceHeightAt(heightGrid, rampGrid, mapWidth, mapHeight, 0.5, 0.1)).toBeCloseTo(1.5);
    expect(surfaceHeightAt(heightGrid, rampGrid, mapWidth, mapHeight, 0.999, 0.9)).toBeCloseTo(
      1.001,
    );

    // The value at the shared edge (fx=1, the ramp's downhill boundary)
    // matches the flat neighbor's constant height exactly -- no seam.
    expect(surfaceHeightAt(heightGrid, rampGrid, mapWidth, mapHeight, 1, 0.5)).toBeCloseTo(1);
  });
});

describe('regression guard: an all-zero rampGrid degenerates to pre-change heightGrid-only behavior', () => {
  it('reproduces the pre-ramp passability semantics (cross-height blocked, same-height open) via edgeProfileAt/profilesEqual', () => {
    // Row of 4 cells, heights [0,1,1,2], no ramps at all (real state of
    // every map before this feature). rampGrid is all zero.
    const mapWidth = 4;
    const mapHeight = 1;
    const heightGrid = new Uint8Array([0, 1, 1, 2]);
    const rampGrid = new Uint8Array(mapWidth * mapHeight); // all zero -- no ramp semantics painted

    // Every cell degenerates to [H,H] on every edge (no slope anywhere).
    for (let x = 0; x < mapWidth; x++) {
      const h = heightGrid[x];
      for (const edge of ['north', 'south', 'east', 'west'] as const) {
        expect(edgeProfileAt(heightGrid, rampGrid, mapWidth, mapHeight, x, 0, edge)).toEqual([
          h,
          h,
        ]);
      }
    }

    // Cross-height boundary (0|1): profiles differ -> blocked, matching the
    // pre-change `sourceHeight !== destHeight` rule in PassabilityGrid.
    const cell0East = edgeProfileAt(heightGrid, rampGrid, mapWidth, mapHeight, 0, 0, 'east');
    const cell1West = edgeProfileAt(heightGrid, rampGrid, mapWidth, mapHeight, 1, 0, 'west');
    expect(profilesEqual(cell0East, cell1West)).toBe(false);

    // Same-height boundary (1|2, both height 1): profiles match -> open,
    // matching the pre-change behavior for two equal-height neighbors.
    const cell1East = edgeProfileAt(heightGrid, rampGrid, mapWidth, mapHeight, 1, 0, 'east');
    const cell2West = edgeProfileAt(heightGrid, rampGrid, mapWidth, mapHeight, 2, 0, 'west');
    expect(profilesEqual(cell1East, cell2West)).toBe(true);

    // computeRampGrid on a fully non-ramp cell list produces the exact same
    // all-zero array shape/content as constructing it directly.
    expect(Array.from(computeRampGrid(mapWidth, mapHeight, heightGrid, []))).toEqual(
      Array.from(rampGrid),
    );
  });
});
