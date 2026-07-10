import { describe, expect, it } from 'vitest';
import {
  computeAutotileQuarterOrigins,
  FLOOR_AUTOTILE_TABLE,
  WALL_AUTOTILE_TABLE,
  WATERFALL_AUTOTILE_TABLE,
} from '../src/geometry/autotile-tables.js';

// Every expected value below is derived by hand from corescript's
// `Tilemap.prototype._addAutotile` (rmmz_core.js) applied to the given tile
// id, using QUARTER_PX = 24 (half of the 48px tile). See that method's
// bx/by/table selection per sheet type -- this test suite exists to pin our
// TypeScript port to those exact numbers.

describe('autotile lookup tables', () => {
  it('has the corescript-documented table sizes (48 floor shapes, 16 wall shapes, 4 waterfall shapes)', () => {
    expect(FLOOR_AUTOTILE_TABLE).toHaveLength(48);
    expect(WALL_AUTOTILE_TABLE).toHaveLength(16);
    expect(WATERFALL_AUTOTILE_TABLE).toHaveLength(4);
  });

  it('shape 0 is the fully-connected interior piece (inner corners of the block)', () => {
    expect(FLOOR_AUTOTILE_TABLE[0]).toEqual([
      [2, 4],
      [1, 4],
      [2, 3],
      [1, 3],
    ]);
  });

  it('shape 47 is the fully-isolated piece (the block-local top-left preview tile)', () => {
    expect(FLOOR_AUTOTILE_TABLE[47]).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it('wall shape 0 uses the wall block interior corners', () => {
    expect(WALL_AUTOTILE_TABLE[0]).toEqual([
      [2, 2],
      [1, 2],
      [2, 1],
      [1, 1],
    ]);
  });
});

describe('computeAutotileQuarterOrigins', () => {
  it('A2 kind 0 shape 0 (first A2 autotile id, tile 2816): resolves bx=0,by=0 against FLOOR_AUTOTILE_TABLE[0]', () => {
    const origins = computeAutotileQuarterOrigins(2816, 'A2');
    expect(origins).toEqual([
      { x: 48, y: 96 },
      { x: 24, y: 96 },
      { x: 48, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('A2 kind 0 shape 47 (isolated edge case, tile 2863): resolves against FLOOR_AUTOTILE_TABLE[47]', () => {
    const origins = computeAutotileQuarterOrigins(2816 + 47, 'A2');
    expect(origins).toEqual([
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 0, y: 24 },
      { x: 24, y: 24 },
    ]);
  });

  it('A3 kind 0 shape 0 (first A3 autotile id, tile 4352): resolves bx=0,by=0 against WALL_AUTOTILE_TABLE[0]', () => {
    const origins = computeAutotileQuarterOrigins(4352, 'A3');
    expect(origins).toEqual([
      { x: 48, y: 48 },
      { x: 24, y: 48 },
      { x: 48, y: 24 },
      { x: 24, y: 24 },
    ]);
  });

  it('A4 first kind (global kind 80, even ty=10) is a floor-type row using FLOOR_AUTOTILE_TABLE', () => {
    // First A4 autotile id (5888) -> global kind 80 -> tx=0, ty=10 (even) -> floor row.
    const origins = computeAutotileQuarterOrigins(5888, 'A4');
    // bx=0, by=0 (same math as A2's first kind) against FLOOR_AUTOTILE_TABLE[0].
    expect(origins).toEqual([
      { x: 48, y: 96 },
      { x: 24, y: 96 },
      { x: 48, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('A4 alternates into a wall-type row once ty is odd (global kind 88 -> ty=11)', () => {
    // global kind 88 -> tileId = 2048 + 88*48 = 6272. tx=0, ty=11 (odd) -> wall row.
    // by = floor((11-10)*2.5 + 0.5) = 3.
    const origins = computeAutotileQuarterOrigins(6272, 'A4');
    expect(origins).toEqual([
      { x: 48, y: 192 },
      { x: 24, y: 192 },
      { x: 48, y: 168 },
      { x: 24, y: 168 },
    ]);
  });

  it('A1 kind 0 (deep water) shape 0 at animation frame 0: hardcoded bx=0,by=0', () => {
    const origins = computeAutotileQuarterOrigins(2048, 'A1');
    expect(origins).toEqual([
      { x: 48, y: 96 },
      { x: 24, y: 96 },
      { x: 48, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('A1 even non-special kind (kind 4) picks FLOOR_AUTOTILE_TABLE via the tx/ty formula', () => {
    // tileId = 2048 + 4*48 = 2240. tx=4, ty=0. bx=floor(4/4)*8=8, by=0*6+(2%2)*3=0.
    const origins = computeAutotileQuarterOrigins(2240, 'A1');
    expect(origins).toEqual([
      { x: 432, y: 96 },
      { x: 408, y: 96 },
      { x: 432, y: 72 },
      { x: 408, y: 72 },
    ]);
  });

  it('A1 odd kind (waterfall, kind 5) switches to WATERFALL_AUTOTILE_TABLE', () => {
    // tileId = 2048 + 5*48 = 2288. tx=5, ty=0. bx=floor(5/4)*8=8, then +6=14 (waterfall offset).
    // by=0*6+(floor(5/2)%2)*3=0, +animationFrame%3=0.
    const origins = computeAutotileQuarterOrigins(2288, 'A1');
    expect(origins).toEqual([
      { x: 720, y: 0 },
      { x: 696, y: 0 },
      { x: 720, y: 24 },
      { x: 696, y: 24 },
    ]);
  });

  it('defensively clamps an out-of-range shape for a smaller table instead of crashing', () => {
    // A3's WALL_AUTOTILE_TABLE only has 16 entries; real map data never emits
    // shape >= 16 for A3, but malformed input should not throw.
    expect(() => computeAutotileQuarterOrigins(4352 + 16, 'A3')).not.toThrow();
  });
});
