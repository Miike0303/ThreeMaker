import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeHeightGrid,
  computeRampGrid,
  edgeProfileAt,
  type GridContext,
  type HeightGridContext,
  heightForRegion,
  profilesEqual,
  type RampCellInput,
  type RampDirection,
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

    const rampGrid = computeRampGrid({ heightGrid, mapWidth, mapHeight }, rampCells);

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
    const ctx = (heightGrid: Uint8Array): HeightGridContext => ({
      heightGrid,
      mapWidth: 3,
      mapHeight: 3,
    });

    // south + east + west + north all candidates -> south wins.
    expect(
      Array.from(
        computeRampGrid(
          ctx(heightsWithCenter({ north: true, south: true, east: true, west: true })),
          rampCells,
        ),
      )[4],
    ).toBe(2); // south

    // east + west + north (no south) -> east wins.
    expect(
      Array.from(
        computeRampGrid(ctx(heightsWithCenter({ north: true, east: true, west: true })), rampCells),
      )[4],
    ).toBe(3); // east

    // west + north (no south, no east) -> west wins.
    expect(
      Array.from(
        computeRampGrid(ctx(heightsWithCenter({ north: true, west: true })), rampCells),
      )[4],
    ).toBe(4); // west
  });

  it('exhaustively resolves every ambiguous 2+/3+/4-candidate combination to the documented south > east > west > north winner', () => {
    // 3x3 grid, center (1,1) at height 2; every in-bounds 4-neighbor is
    // available as a candidate slot. For every non-empty subset of
    // {north,south,east,west} with 2+ members, set exactly those neighbors
    // to height 1 (candidates) and confirm the resolved direction is the
    // FIRST one (in south > east > west > north priority) present in the
    // subset -- exhaustive over all C(4,2)+C(4,3)+C(4,4) = 11 combinations.
    const DIRECTIONS: readonly RampDirection[] = ['north', 'south', 'east', 'west'];
    const PRIORITY: readonly RampDirection[] = ['south', 'east', 'west', 'north'];
    const OFFSET: Record<RampDirection, { x: number; y: number }> = {
      north: { x: 1, y: 0 },
      south: { x: 1, y: 2 },
      east: { x: 2, y: 1 },
      west: { x: 0, y: 1 },
    };
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 1 }];

    for (let mask = 0b0011; mask <= 0b1111; mask++) {
      const subset = DIRECTIONS.filter((_, i) => (mask & (1 << i)) !== 0);
      if (subset.length < 2) continue; // only ambiguous (2+) combinations exercise the tie-break

      const heightGrid = new Uint8Array(9).fill(2);
      for (const direction of subset) {
        const { x, y } = OFFSET[direction];
        heightGrid[y * 3 + x] = 1;
      }

      const expected = PRIORITY.find((direction) => subset.includes(direction));
      const rampGrid = computeRampGrid({ heightGrid, mapWidth: 3, mapHeight: 3 }, rampCells);

      expect(rampGrid[4], `subset=[${subset.join(',')}]`).toBe(
        expected === undefined ? 0 : { north: 1, south: 2, east: 3, west: 4 }[expected],
      );
    }
  });

  it('honors an explicit rampDirection override over the tie-break result', () => {
    // Center (1,1) height 2; both east and west sit at height 1, so the
    // auto tie-break (south>east>west>north) would normally pick 'east'.
    // An explicit override of 'west' must win instead.
    const heightGrid = new Uint8Array([2, 2, 2, 1, 2, 1, 2, 2, 2]);
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 1, rampDirection: 'west' }];

    const rampGrid = computeRampGrid({ heightGrid, mapWidth: 3, mapHeight: 3 }, rampCells);

    expect(rampGrid[4]).toBe(4); // west, not the tie-break's 'east'
  });

  it('falls through an INVALID override (wrong height diff) to the unique auto-derived candidate, per design precedence "valid override > unique candidate > tie-break > inert"', () => {
    // Center (1,1) height 2. Override points 'north', but north sits at
    // height 2 (diff 0, not exactly one level below) -- an invalid
    // override. South is the only valid (diff===1) candidate.
    const heightGrid = new Uint8Array([2, 2, 2, 2, 2, 2, 2, 1, 2]);
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 1, rampDirection: 'north' }];

    const rampGrid = computeRampGrid({ heightGrid, mapWidth: 3, mapHeight: 3 }, rampCells);

    expect(rampGrid[4]).toBe(2); // south, auto-derived -- override ignored, not treated as inert
  });

  it('falls through an INVALID override (too-steep diff) to the unique auto-derived candidate', () => {
    // Center (1,1) height 3. Override points 'south', but south drops 2
    // levels to height 1 (invalid: diff must be exactly 1). North is the
    // only valid candidate (height 2, diff 1).
    const heightGrid = new Uint8Array([3, 2, 3, 3, 3, 3, 3, 1, 3]);
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 1, rampDirection: 'south' }];

    const rampGrid = computeRampGrid({ heightGrid, mapWidth: 3, mapHeight: 3 }, rampCells);

    expect(rampGrid[4]).toBe(1); // north, auto-derived
  });

  it('falls through an INVALID override to the tie-break winner when 2+ valid candidates remain ambiguous', () => {
    // Center (1,1) height 2. Override 'north' is invalid (diff 0). South
    // and east both qualify (diff 1) -- south must win the tie-break, not
    // east, even though east comes second only to south by coincidence of
    // this layout.
    const heightGrid = new Uint8Array([2, 2, 2, 2, 2, 1, 2, 1, 2]);
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 1, rampDirection: 'north' }];

    const rampGrid = computeRampGrid({ heightGrid, mapWidth: 3, mapHeight: 3 }, rampCells);

    expect(rampGrid[4]).toBe(2); // south wins the tie-break among the valid candidates
  });

  it('treats a multi-level-span ramp cell as inert (not rejected) and logs a dev warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // (0,0) height 3, its explicit override points south to (0,1) at
    // height 0 -- a 3-level drop, not the single level a ramp supports.
    const heightGrid = new Uint8Array([3, 0]);
    const rampCells: readonly RampCellInput[] = [{ x: 0, y: 0, rampDirection: 'south' }];

    const rampGrid = computeRampGrid({ heightGrid, mapWidth: 1, mapHeight: 2 }, rampCells);

    expect(rampGrid[0]).toBe(0); // inert, not rejected -- computeRampGrid never throws
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/multi-level span/i);
  });

  it('treats an auto-derive (no override) multi-level span as inert with a dev warning, without any rampDirection input', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Center (1,1) height 3, no override. North is off-map (ground=0, a
    // 3-level drop); every in-bounds neighbor sits at the SAME height
    // (diff 0, not a candidate). No exact H-1 neighbor exists anywhere, so
    // the cell is inert -- but since a neighbor (off-map ground) is MORE
    // than 1 level below, this must warn (not silently go inert).
    const heightGrid = new Uint8Array([3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 0 }]; // (1,0): north is off-map

    const rampGrid = computeRampGrid({ heightGrid, mapWidth: 3, mapHeight: 3 }, rampCells);

    expect(rampGrid[1]).toBe(0); // inert
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/multi-level span/i);
  });

  it('leaves a cell inert without warning when no neighbor sits below it at all (flat plateau)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 3x3, all height 2: center (1,1) has all 4 neighbors in-bounds at the
    // SAME height (not off-map, so no phantom ground-level distant drop).
    const heightGrid = new Uint8Array(9).fill(2);
    const rampCells: readonly RampCellInput[] = [{ x: 1, y: 1 }];

    const rampGrid = computeRampGrid({ heightGrid, mapWidth: 3, mapHeight: 3 }, rampCells);

    expect(rampGrid[4]).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('edgeProfileAt', () => {
  it('returns [H,H] for every edge of a flat (non-ramp) cell', () => {
    const ctx: GridContext = {
      heightGrid: new Uint8Array([2]),
      rampGrid: new Uint8Array([0]),
      mapWidth: 1,
      mapHeight: 1,
    };

    for (const edge of ['north', 'south', 'east', 'west'] as const) {
      expect(edgeProfileAt(ctx, 0, 0, edge)).toEqual([2, 2]);
    }
  });

  it('returns ground ([0,0]) for out-of-bounds coordinates', () => {
    const ctx: GridContext = {
      heightGrid: new Uint8Array([5]),
      rampGrid: new Uint8Array([0]),
      mapWidth: 1,
      mapHeight: 1,
    };

    expect(edgeProfileAt(ctx, -1, 0, 'east')).toEqual([0, 0]);
    expect(edgeProfileAt(ctx, 1, 0, 'west')).toEqual([0, 0]);
    expect(edgeProfileAt(ctx, 0, 5, 'north')).toEqual([0, 0]);
  });

  it('gives a ramp cell canonical-order profiles that match its flat neighbor from both perspectives (profilesEqual symmetric)', () => {
    // 1-wide, 2-tall map: (0,0) height 2, ramp direction south; (0,1) is
    // flat at height 1 -- exactly the neighbor the ramp descends to.
    const mapWidth = 1;
    const mapHeight = 2;
    const heightGrid = new Uint8Array([2, 1]);
    const rampGrid = computeRampGrid({ heightGrid, mapWidth, mapHeight }, [{ x: 0, y: 0 }]);
    expect(rampGrid[0]).toBe(2); // south, auto-derived (unique candidate)
    const ctx: GridContext = { heightGrid, rampGrid, mapWidth, mapHeight };

    // Ramp cell's own south edge (its downhill edge) sits at H-1 = 1.
    const rampSouthEdge = edgeProfileAt(ctx, 0, 0, 'south');
    expect(rampSouthEdge).toEqual([1, 1]);

    // Neighbor's north edge, from ITS OWN perspective (flat, height 1).
    const neighborNorthEdge = edgeProfileAt(ctx, 0, 1, 'north');
    expect(neighborNorthEdge).toEqual([1, 1]);

    // Same shared edge, computed from both sides: equal -> the step is open.
    expect(profilesEqual(rampSouthEdge, neighborNorthEdge)).toBe(true);

    // The ramp's own north (uphill, opposite) edge stays at its own height.
    const rampNorthEdge = edgeProfileAt(ctx, 0, 0, 'north');
    expect(rampNorthEdge).toEqual([2, 2]);

    // The perpendicular edges slope linearly between the two heights, and
    // (since direction is north/south) both perpendicular edges match.
    const eastEdge = edgeProfileAt(ctx, 0, 0, 'east');
    const westEdge = edgeProfileAt(ctx, 0, 0, 'west');
    expect(eastEdge).toEqual([2, 1]);
    expect(westEdge).toEqual([2, 1]);
  });
});

describe('EdgeProfile symmetry (canonical corner ordering) across neighboring cells', () => {
  it('flat map: every east/west and north/south edge pair matches from both adjacent cells, across a range of positions', () => {
    const mapWidth = 5;
    const mapHeight = 5;
    const ctx: GridContext = {
      heightGrid: new Uint8Array(mapWidth * mapHeight).fill(3),
      rampGrid: new Uint8Array(mapWidth * mapHeight),
      mapWidth,
      mapHeight,
    };

    for (let x = 0; x < mapWidth - 1; x++) {
      for (let y = 0; y < mapHeight; y++) {
        expect(
          profilesEqual(edgeProfileAt(ctx, x, y, 'east'), edgeProfileAt(ctx, x + 1, y, 'west')),
        ).toBe(true);
      }
    }
    for (let x = 0; x < mapWidth; x++) {
      for (let y = 0; y < mapHeight - 1; y++) {
        expect(
          profilesEqual(edgeProfileAt(ctx, x, y, 'south'), edgeProfileAt(ctx, x, y + 1, 'north')),
        ).toBe(true);
      }
    }
  });

  it('a ramp cell and its downhill flat neighbor agree on the shared edge from an off-origin position (both directions)', () => {
    const mapWidth = 5;
    const mapHeight = 5;
    const heightGrid = new Uint8Array(mapWidth * mapHeight).fill(2);
    heightGrid[3 * mapWidth + 2] = 1; // (2,3), one level below (2,2)
    const rampGrid = computeRampGrid({ heightGrid, mapWidth, mapHeight }, [{ x: 2, y: 2 }]);
    expect(rampGrid[2 * mapWidth + 2]).toBe(2); // south, auto-derived
    const ctx: GridContext = { heightGrid, rampGrid, mapWidth, mapHeight };

    const rampSouth = edgeProfileAt(ctx, 2, 2, 'south');
    const neighborNorth = edgeProfileAt(ctx, 2, 3, 'north');
    expect(profilesEqual(rampSouth, neighborNorth)).toBe(true);
    expect(rampSouth).toEqual(neighborNorth);

    // Same physical setup rotated 90 degrees: an east-ramping cell and its
    // downhill flat neighbor to the east must also agree on their shared
    // (east/west) edge from an off-origin position.
    const heightGrid2 = new Uint8Array(mapWidth * mapHeight).fill(2);
    heightGrid2[1 * mapWidth + 3] = 1; // (3,1), one level below (2,1)
    const rampGrid2 = computeRampGrid({ heightGrid: heightGrid2, mapWidth, mapHeight }, [
      { x: 2, y: 1 },
    ]);
    expect(rampGrid2[1 * mapWidth + 2]).toBe(3); // east, auto-derived
    const ctx2: GridContext = { heightGrid: heightGrid2, rampGrid: rampGrid2, mapWidth, mapHeight };

    const rampEast = edgeProfileAt(ctx2, 2, 1, 'east');
    const neighborWest = edgeProfileAt(ctx2, 3, 1, 'west');
    expect(profilesEqual(rampEast, neighborWest)).toBe(true);
    expect(rampEast).toEqual(neighborWest);
  });

  it('parallel identical ramps (wide stairs) share a matching perpendicular edge', () => {
    // Two side-by-side cells, both ramping south at the same own height --
    // their shared east/west edge (the slope's perpendicular boundary)
    // must match exactly, since both compute an identical [H,H-1] slope
    // along that shared edge from either side.
    const mapWidth = 2;
    const mapHeight = 2;
    const heightGrid = new Uint8Array([2, 2, 1, 1]);
    const rampGrid = computeRampGrid({ heightGrid, mapWidth, mapHeight }, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(rampGrid[0]).toBe(2); // south
    expect(rampGrid[1]).toBe(2); // south
    const ctx: GridContext = { heightGrid, rampGrid, mapWidth, mapHeight };

    const eastEdge = edgeProfileAt(ctx, 0, 0, 'east');
    const westEdge = edgeProfileAt(ctx, 1, 0, 'west');
    expect(profilesEqual(eastEdge, westEdge)).toBe(true);
    expect(eastEdge).toEqual(westEdge);
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
    const ctx: GridContext = {
      heightGrid: new Uint8Array([3]),
      rampGrid: new Uint8Array([0]),
      mapWidth: 1,
      mapHeight: 1,
    };

    expect(surfaceHeightAt(ctx, 0, 0)).toBe(3);
    expect(surfaceHeightAt(ctx, 0.25, 0.75)).toBe(3);
    expect(surfaceHeightAt(ctx, 0.999, 0.001)).toBe(3);
  });

  it('returns the EXACT integer height (no float drift) off-ramp, at both integer and fractional positions on a bigger flat map', () => {
    const mapWidth = 4;
    const mapHeight = 4;
    const ctx: GridContext = {
      heightGrid: new Uint8Array(mapWidth * mapHeight).fill(5),
      rampGrid: new Uint8Array(mapWidth * mapHeight),
      mapWidth,
      mapHeight,
    };

    for (const [fx, fy] of [
      [0, 0],
      [2, 2],
      [3.999, 3.999],
      [1.5, 2.25],
      [0.0001, 3.9999],
    ] as const) {
      expect(surfaceHeightAt(ctx, fx, fy)).toBe(5);
    }
  });

  it("interpolates linearly across a ramp cell's slope", () => {
    // (0,0) height 2, ramp direction east; (1,0) flat at height 1.
    const mapWidth = 2;
    const mapHeight = 1;
    const heightGrid = new Uint8Array([2, 1]);
    const rampGrid = computeRampGrid({ heightGrid, mapWidth, mapHeight }, [{ x: 0, y: 0 }]);
    expect(rampGrid[0]).toBe(3); // east, auto-derived
    const ctx: GridContext = { heightGrid, rampGrid, mapWidth, mapHeight };

    // Along the ramp's own cell (x in [0,1)): height = 2 - u (u = fx - 0).
    expect(surfaceHeightAt(ctx, 0, 0.5)).toBeCloseTo(2);
    expect(surfaceHeightAt(ctx, 0.25, 0.5)).toBeCloseTo(1.75);
    expect(surfaceHeightAt(ctx, 0.5, 0.1)).toBeCloseTo(1.5);
    expect(surfaceHeightAt(ctx, 0.999, 0.9)).toBeCloseTo(1.001);

    // The value at the shared edge (fx=1, the ramp's downhill boundary)
    // matches the flat neighbor's constant height exactly -- no seam.
    expect(surfaceHeightAt(ctx, 1, 0.5)).toBeCloseTo(1);
  });

  it('samples height in the CORRECT direction across a south-downhill ramp (rising south->north, i.e. toward smaller y): never flipped to downhill-north', () => {
    // Single ramp cell, height 2, downhill direction south: its own north
    // edge (uphill, opposite of downhill) stays at 2; its south edge
    // (downhill) sits at 1. Walking from fy=0 (north boundary) to fy=1
    // (south boundary) must monotonically DECREASE -- i.e. going north
    // (toward smaller y) the surface RISES, matching "rising south->north".
    const mapWidth = 1;
    const mapHeight = 1;
    const heightGrid = new Uint8Array([2]);
    const rampGrid = new Uint8Array([2]); // south downhill (RAMP_DIRECTION_CODE.south)
    const ctx: GridContext = { heightGrid, rampGrid, mapWidth, mapHeight };

    const samples = [0, 0.25, 0.5, 0.75, 1].map((fy) => surfaceHeightAt(ctx, 0.5, fy));

    expect(samples[0]).toBeCloseTo(2); // north edge: uphill, own height
    expect(samples[samples.length - 1]).toBeCloseTo(1); // south edge: downhill, H-1
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1]); // strictly decreasing southward -- not flipped
    }
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
    const ctx: GridContext = { heightGrid, rampGrid, mapWidth, mapHeight };

    // Every cell degenerates to [H,H] on every edge (no slope anywhere).
    for (let x = 0; x < mapWidth; x++) {
      const h = heightGrid[x];
      for (const edge of ['north', 'south', 'east', 'west'] as const) {
        expect(edgeProfileAt(ctx, x, 0, edge)).toEqual([h, h]);
      }
    }

    // Cross-height boundary (0|1): profiles differ -> blocked, matching the
    // pre-change `sourceHeight !== destHeight` rule in PassabilityGrid.
    const cell0East = edgeProfileAt(ctx, 0, 0, 'east');
    const cell1West = edgeProfileAt(ctx, 1, 0, 'west');
    expect(profilesEqual(cell0East, cell1West)).toBe(false);

    // Same-height boundary (1|2, both height 1): profiles match -> open,
    // matching the pre-change behavior for two equal-height neighbors.
    const cell1East = edgeProfileAt(ctx, 1, 0, 'east');
    const cell2West = edgeProfileAt(ctx, 2, 0, 'west');
    expect(profilesEqual(cell1East, cell2West)).toBe(true);

    // computeRampGrid on a fully non-ramp cell list produces the exact same
    // all-zero array shape/content as constructing it directly.
    expect(Array.from(computeRampGrid({ heightGrid, mapWidth, mapHeight }, []))).toEqual(
      Array.from(rampGrid),
    );
  });
});
