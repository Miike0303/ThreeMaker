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
  it('uses both upper and the lower-left inner corners for floor shape 11', () => {
    expect(computeAutotileQuarterOrigins(2816 + 11, 'A2')).toEqual([
      { x: 48, y: 0 },
      { x: 72, y: 0 },
      { x: 48, y: 24 },
      { x: 24, y: 72 },
    ]);
  });

  it('uses both left and the lower-right inner corners for floor shape 13', () => {
    expect(computeAutotileQuarterOrigins(2816 + 13, 'A2')).toEqual([
      { x: 48, y: 0 },
      { x: 24, y: 96 },
      { x: 48, y: 24 },
      { x: 72, y: 24 },
    ]);
  });

  it('uses both lower and the upper-right inner corners for floor shape 14', () => {
    expect(computeAutotileQuarterOrigins(2816 + 14, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 72, y: 0 },
      { x: 48, y: 24 },
      { x: 72, y: 24 },
    ]);
  });

  it('caps the left edge with a lower-right inner corner for floor shape 18', () => {
    expect(computeAutotileQuarterOrigins(2816 + 18, 'A2')).toEqual([
      { x: 0, y: 96 },
      { x: 24, y: 96 },
      { x: 0, y: 72 },
      { x: 72, y: 24 },
    ]);
  });

  it('caps the left edge with both right inner corners for floor shape 19', () => {
    expect(computeAutotileQuarterOrigins(2816 + 19, 'A2')).toEqual([
      { x: 0, y: 96 },
      { x: 72, y: 0 },
      { x: 0, y: 72 },
      { x: 72, y: 24 },
    ]);
  });

  it('caps the top edge with a lower-right inner corner for floor shape 21', () => {
    expect(computeAutotileQuarterOrigins(2816 + 21, 'A2')).toEqual([
      { x: 48, y: 48 },
      { x: 24, y: 48 },
      { x: 48, y: 72 },
      { x: 72, y: 24 },
    ]);
  });

  it('caps the top edge with a lower-left inner corner for floor shape 22', () => {
    expect(computeAutotileQuarterOrigins(2816 + 22, 'A2')).toEqual([
      { x: 48, y: 48 },
      { x: 24, y: 48 },
      { x: 48, y: 24 },
      { x: 24, y: 72 },
    ]);
  });

  it('caps the top edge with both lower inner corners for floor shape 23', () => {
    expect(computeAutotileQuarterOrigins(2816 + 23, 'A2')).toEqual([
      { x: 48, y: 48 },
      { x: 24, y: 48 },
      { x: 48, y: 24 },
      { x: 72, y: 24 },
    ]);
  });

  it('uses diagonal upper-left and lower-right inner corners for floor shape 5', () => {
    expect(computeAutotileQuarterOrigins(2816 + 5, 'A2')).toEqual([
      { x: 48, y: 0 },
      { x: 24, y: 96 },
      { x: 48, y: 72 },
      { x: 72, y: 24 },
    ]);
  });

  it('uses both right inner corners for floor shape 6', () => {
    expect(computeAutotileQuarterOrigins(2816 + 6, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 72, y: 0 },
      { x: 48, y: 72 },
      { x: 72, y: 24 },
    ]);
  });

  it('uses both upper and the lower-right inner corners for floor shape 7', () => {
    expect(computeAutotileQuarterOrigins(2816 + 7, 'A2')).toEqual([
      { x: 48, y: 0 },
      { x: 72, y: 0 },
      { x: 48, y: 72 },
      { x: 72, y: 24 },
    ]);
  });

  it('uses both left inner corners for floor shape 9', () => {
    expect(computeAutotileQuarterOrigins(2816 + 9, 'A2')).toEqual([
      { x: 48, y: 0 },
      { x: 24, y: 96 },
      { x: 48, y: 24 },
      { x: 24, y: 72 },
    ]);
  });

  it('uses diagonal upper-right and lower-left inner corners for floor shape 10', () => {
    expect(computeAutotileQuarterOrigins(2816 + 10, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 72, y: 0 },
      { x: 48, y: 24 },
      { x: 24, y: 72 },
    ]);
  });

  it('uses both lower inner corners for floor shape 12', () => {
    expect(computeAutotileQuarterOrigins(2816 + 12, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 24, y: 96 },
      { x: 48, y: 24 },
      { x: 72, y: 24 },
    ]);
  });

  it('caps the bottom-left outside wall corner for shape 9', () => {
    expect(computeAutotileQuarterOrigins(4352 + 9, 'A3')).toEqual([
      { x: 0, y: 48 },
      { x: 24, y: 48 },
      { x: 0, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('caps the bottom-right outside wall corner for shape 12', () => {
    expect(computeAutotileQuarterOrigins(4352 + 12, 'A3')).toEqual([
      { x: 48, y: 48 },
      { x: 72, y: 48 },
      { x: 48, y: 72 },
      { x: 72, y: 72 },
    ]);
  });

  it('caps the top of a vertical wall strip for shape 7', () => {
    expect(computeAutotileQuarterOrigins(4352 + 7, 'A3')).toEqual([
      { x: 0, y: 0 },
      { x: 72, y: 0 },
      { x: 0, y: 24 },
      { x: 72, y: 24 },
    ]);
  });

  it('caps the left of a horizontal wall strip for shape 11', () => {
    expect(computeAutotileQuarterOrigins(4352 + 11, 'A3')).toEqual([
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 0, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('caps the bottom of a vertical wall strip for shape 13', () => {
    expect(computeAutotileQuarterOrigins(4352 + 13, 'A3')).toEqual([
      { x: 0, y: 48 },
      { x: 72, y: 48 },
      { x: 0, y: 72 },
      { x: 72, y: 72 },
    ]);
  });

  it('caps the right of a horizontal wall strip for shape 14', () => {
    expect(computeAutotileQuarterOrigins(4352 + 14, 'A3')).toEqual([
      { x: 48, y: 0 },
      { x: 72, y: 0 },
      { x: 48, y: 72 },
      { x: 72, y: 72 },
    ]);
  });

  it('uses both upper inner corners for floor shape 3', () => {
    expect(computeAutotileQuarterOrigins(2816 + 3, 'A2')).toEqual([
      { x: 48, y: 0 },
      { x: 72, y: 0 },
      { x: 48, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('uses all four inner corners for floor shape 15', () => {
    expect(computeAutotileQuarterOrigins(2816 + 15, 'A2')).toEqual([
      { x: 48, y: 0 },
      { x: 72, y: 0 },
      { x: 48, y: 24 },
      { x: 72, y: 24 },
    ]);
  });

  it('caps the top of a vertical floor strip for shape 42', () => {
    expect(computeAutotileQuarterOrigins(2816 + 42, 'A2')).toEqual([
      { x: 0, y: 48 },
      { x: 72, y: 48 },
      { x: 0, y: 72 },
      { x: 72, y: 72 },
    ]);
  });

  it('caps the left of a horizontal floor strip for shape 43', () => {
    expect(computeAutotileQuarterOrigins(2816 + 43, 'A2')).toEqual([
      { x: 0, y: 48 },
      { x: 24, y: 48 },
      { x: 0, y: 120 },
      { x: 24, y: 120 },
    ]);
  });

  it('caps the bottom of a vertical floor strip for shape 44', () => {
    expect(computeAutotileQuarterOrigins(2816 + 44, 'A2')).toEqual([
      { x: 0, y: 96 },
      { x: 72, y: 96 },
      { x: 0, y: 120 },
      { x: 72, y: 120 },
    ]);
  });

  it('caps the right of a horizontal floor strip for shape 45', () => {
    expect(computeAutotileQuarterOrigins(2816 + 45, 'A2')).toEqual([
      { x: 48, y: 48 },
      { x: 72, y: 48 },
      { x: 48, y: 120 },
      { x: 72, y: 120 },
    ]);
  });

  it('caps both sides of a vertical wall strip for shape 5', () => {
    expect(computeAutotileQuarterOrigins(4352 + 5, 'A3')).toEqual([
      { x: 0, y: 48 },
      { x: 72, y: 48 },
      { x: 0, y: 24 },
      { x: 72, y: 24 },
    ]);
  });

  it('caps both ends of a horizontal wall strip for shape 10', () => {
    expect(computeAutotileQuarterOrigins(4352 + 10, 'A3')).toEqual([
      { x: 48, y: 0 },
      { x: 24, y: 0 },
      { x: 48, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('caps every side of an isolated wall for shape 15', () => {
    expect(computeAutotileQuarterOrigins(4352 + 15, 'A3')).toEqual([
      { x: 0, y: 0 },
      { x: 72, y: 0 },
      { x: 0, y: 72 },
      { x: 72, y: 72 },
    ]);
  });

  it('caps both sides of a vertical floor strip for shape 32', () => {
    expect(computeAutotileQuarterOrigins(2816 + 32, 'A2')).toEqual([
      { x: 0, y: 96 },
      { x: 72, y: 96 },
      { x: 0, y: 72 },
      { x: 72, y: 72 },
    ]);
  });

  it('caps both ends of a horizontal floor strip for shape 33', () => {
    expect(computeAutotileQuarterOrigins(2816 + 33, 'A2')).toEqual([
      { x: 48, y: 48 },
      { x: 24, y: 48 },
      { x: 48, y: 120 },
      { x: 24, y: 120 },
    ]);
  });

  it('caps the top-left outside floor corner for shape 34', () => {
    expect(computeAutotileQuarterOrigins(2816 + 34, 'A2')).toEqual([
      { x: 0, y: 48 },
      { x: 24, y: 48 },
      { x: 0, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('caps the top-right outside floor corner for shape 36', () => {
    expect(computeAutotileQuarterOrigins(2816 + 36, 'A2')).toEqual([
      { x: 48, y: 48 },
      { x: 72, y: 48 },
      { x: 48, y: 72 },
      { x: 72, y: 72 },
    ]);
  });

  it('caps the bottom-right outside floor corner for shape 38', () => {
    expect(computeAutotileQuarterOrigins(2816 + 38, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 72, y: 96 },
      { x: 48, y: 120 },
      { x: 72, y: 120 },
    ]);
  });

  it('caps the bottom-left outside floor corner for shape 40', () => {
    expect(computeAutotileQuarterOrigins(2816 + 40, 'A2')).toEqual([
      { x: 0, y: 96 },
      { x: 24, y: 96 },
      { x: 0, y: 120 },
      { x: 24, y: 120 },
    ]);
  });

  it('caps the left edge for floor shape 16', () => {
    expect(computeAutotileQuarterOrigins(2816 + 16, 'A2')).toEqual([
      { x: 0, y: 96 },
      { x: 24, y: 96 },
      { x: 0, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('caps the top edge for floor shape 20', () => {
    expect(computeAutotileQuarterOrigins(2816 + 20, 'A2')).toEqual([
      { x: 48, y: 48 },
      { x: 24, y: 48 },
      { x: 48, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('caps the right edge for floor shape 24', () => {
    expect(computeAutotileQuarterOrigins(2816 + 24, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 72, y: 96 },
      { x: 48, y: 72 },
      { x: 72, y: 72 },
    ]);
  });

  it('caps the bottom edge for floor shape 28', () => {
    expect(computeAutotileQuarterOrigins(2816 + 28, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 24, y: 96 },
      { x: 48, y: 120 },
      { x: 24, y: 120 },
    ]);
  });

  it('caps the top-left corner for wall shape 3', () => {
    expect(computeAutotileQuarterOrigins(4352 + 3, 'A3')).toEqual([
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 0, y: 24 },
      { x: 24, y: 24 },
    ]);
  });

  it('caps the top-right corner for wall shape 6', () => {
    expect(computeAutotileQuarterOrigins(4352 + 6, 'A3')).toEqual([
      { x: 48, y: 0 },
      { x: 72, y: 0 },
      { x: 48, y: 24 },
      { x: 72, y: 24 },
    ]);
  });

  it('selects the right cap for waterfall shape 2', () => {
    expect(computeAutotileQuarterOrigins(2288 + 2, 'A1')).toEqual([
      { x: 720, y: 0 },
      { x: 744, y: 0 },
      { x: 720, y: 24 },
      { x: 696, y: 24 },
    ]);
  });

  it('selects both cap columns for waterfall shape 3', () => {
    expect(computeAutotileQuarterOrigins(2288 + 3, 'A1')).toEqual([
      { x: 672, y: 0 },
      { x: 744, y: 0 },
      { x: 672, y: 24 },
      { x: 696, y: 24 },
    ]);
  });

  it('caps the left edge for waterfall shape 1', () => {
    expect(computeAutotileQuarterOrigins(2289, 'A1')).toEqual([
      { x: 672, y: 0 },
      { x: 696, y: 0 },
      { x: 672, y: 24 },
      { x: 696, y: 24 },
    ]);
  });
  it('uses the upper-left inner corner for floor shape 1', () => {
    expect(computeAutotileQuarterOrigins(2817, 'A2')).toEqual([
      { x: 48, y: 0 },
      { x: 24, y: 96 },
      { x: 48, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('uses the upper-right inner corner for floor shape 2', () => {
    expect(computeAutotileQuarterOrigins(2818, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 72, y: 0 },
      { x: 48, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('uses the lower-right inner corner for floor shape 4', () => {
    expect(computeAutotileQuarterOrigins(2820, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 24, y: 96 },
      { x: 48, y: 72 },
      { x: 72, y: 24 },
    ]);
  });

  it('uses the lower-left inner corner for floor shape 8', () => {
    expect(computeAutotileQuarterOrigins(2824, 'A2')).toEqual([
      { x: 48, y: 96 },
      { x: 24, y: 96 },
      { x: 48, y: 24 },
      { x: 24, y: 72 },
    ]);
  });

  it('caps the left edge for wall shape 1', () => {
    expect(computeAutotileQuarterOrigins(4353, 'A3')).toEqual([
      { x: 0, y: 48 },
      { x: 24, y: 48 },
      { x: 0, y: 24 },
      { x: 24, y: 24 },
    ]);
  });

  it('caps the top edge for wall shape 2', () => {
    expect(computeAutotileQuarterOrigins(4354, 'A3')).toEqual([
      { x: 48, y: 0 },
      { x: 24, y: 0 },
      { x: 48, y: 24 },
      { x: 24, y: 24 },
    ]);
  });

  it('caps the right edge for wall shape 4', () => {
    expect(computeAutotileQuarterOrigins(4356, 'A3')).toEqual([
      { x: 48, y: 48 },
      { x: 72, y: 48 },
      { x: 48, y: 24 },
      { x: 72, y: 24 },
    ]);
  });

  it('caps the bottom edge for wall shape 8', () => {
    expect(computeAutotileQuarterOrigins(4360, 'A3')).toEqual([
      { x: 48, y: 48 },
      { x: 24, y: 48 },
      { x: 48, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('advances the second A1 water kind to its second surface frame', () => {
    expect(computeAutotileQuarterOrigins(2096, 'A1', 1)).toEqual([
      { x: 144, y: 240 },
      { x: 120, y: 240 },
      { x: 144, y: 216 },
      { x: 120, y: 216 },
    ]);
  });

  it('starts the second A1 kind row six tile rows down', () => {
    expect(computeAutotileQuarterOrigins(2432, 'A1')).toEqual([
      { x: 48, y: 384 },
      { x: 24, y: 384 },
      { x: 48, y: 360 },
      { x: 24, y: 360 },
    ]);
  });

  it('animates ordinary even A1 kinds within their own water block', () => {
    expect(computeAutotileQuarterOrigins(2240, 'A1', 1)).toEqual([
      { x: 528, y: 96 },
      { x: 504, y: 96 },
      { x: 528, y: 72 },
      { x: 504, y: 72 },
    ]);
  });

  it('advances adjacent A4 kinds by two tile columns', () => {
    expect(computeAutotileQuarterOrigins(5936, 'A4')).toEqual([
      { x: 144, y: 96 },
      { x: 120, y: 96 },
      { x: 144, y: 72 },
      { x: 120, y: 72 },
    ]);
  });

  it('starts the next A4 roof row after a five-tile roof and wall pair', () => {
    expect(computeAutotileQuarterOrigins(6656, 'A4')).toEqual([
      { x: 48, y: 336 },
      { x: 24, y: 336 },
      { x: 48, y: 312 },
      { x: 24, y: 312 },
    ]);
  });

  it('repeats the A1 water surface cycle after four frames', () => {
    expect(computeAutotileQuarterOrigins(2048, 'A1', 5)).toEqual([
      { x: 144, y: 96 },
      { x: 120, y: 96 },
      { x: 144, y: 72 },
      { x: 120, y: 72 },
    ]);
  });

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

  it('uses the second A1 water surface frame at animation frame 1', () => {
    expect(computeAutotileQuarterOrigins(2048, 'A1', 1)).toEqual([
      { x: 144, y: 96 },
      { x: 120, y: 96 },
      { x: 144, y: 72 },
      { x: 120, y: 72 },
    ]);
  });

  it('moves A1 deep water to its third surface frame at animation frame 2', () => {
    expect(computeAutotileQuarterOrigins(2048, 'A1', 2)).toEqual([
      { x: 240, y: 96 },
      { x: 216, y: 96 },
      { x: 240, y: 72 },
      { x: 216, y: 72 },
    ]);
  });

  it('returns A1 deep water to the second surface frame at animation frame 3', () => {
    expect(computeAutotileQuarterOrigins(2048, 'A1', 3)).toEqual([
      { x: 144, y: 96 },
      { x: 120, y: 96 },
      { x: 144, y: 72 },
      { x: 120, y: 72 },
    ]);
  });

  it('places the second A1 water kind three tile rows below the first', () => {
    expect(computeAutotileQuarterOrigins(2096, 'A1')).toEqual([
      { x: 48, y: 240 },
      { x: 24, y: 240 },
      { x: 48, y: 216 },
      { x: 24, y: 216 },
    ]);
  });

  it('places the third A1 water kind six tile columns from the sheet origin', () => {
    expect(computeAutotileQuarterOrigins(2144, 'A1')).toEqual([
      { x: 336, y: 96 },
      { x: 312, y: 96 },
      { x: 336, y: 72 },
      { x: 312, y: 72 },
    ]);
  });

  it('places the fourth A1 water kind in the lower right water block', () => {
    expect(computeAutotileQuarterOrigins(2192, 'A1')).toEqual([
      { x: 336, y: 240 },
      { x: 312, y: 240 },
      { x: 336, y: 216 },
      { x: 312, y: 216 },
    ]);
  });

  it('places A1 kind 6 in the lower water block', () => {
    expect(computeAutotileQuarterOrigins(2336, 'A1')).toEqual([
      { x: 432, y: 240 },
      { x: 408, y: 240 },
      { x: 432, y: 216 },
      { x: 408, y: 216 },
    ]);
  });

  it('advances the second A2 kind by two horizontal block units', () => {
    expect(computeAutotileQuarterOrigins(2864, 'A2')).toEqual([
      { x: 144, y: 96 },
      { x: 120, y: 96 },
      { x: 144, y: 72 },
      { x: 120, y: 72 },
    ]);
  });

  it('advances A2 kinds in the second row by three tile rows', () => {
    expect(computeAutotileQuarterOrigins(3200, 'A2')).toEqual([
      { x: 48, y: 240 },
      { x: 24, y: 240 },
      { x: 48, y: 216 },
      { x: 24, y: 216 },
    ]);
  });

  it('advances the second A3 kind by two horizontal block units', () => {
    expect(computeAutotileQuarterOrigins(4400, 'A3')).toEqual([
      { x: 144, y: 48 },
      { x: 120, y: 48 },
      { x: 144, y: 24 },
      { x: 120, y: 24 },
    ]);
  });

  it('advances A3 kinds in the second row by two tile rows', () => {
    expect(computeAutotileQuarterOrigins(4736, 'A3')).toEqual([
      { x: 48, y: 144 },
      { x: 24, y: 144 },
      { x: 48, y: 120 },
      { x: 24, y: 120 },
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

  it('moves an A1 waterfall to its third animation row at frame 2', () => {
    expect(computeAutotileQuarterOrigins(2288, 'A1', 2)).toEqual([
      { x: 720, y: 96 },
      { x: 696, y: 96 },
      { x: 720, y: 120 },
      { x: 696, y: 120 },
    ]);
  });

  it('returns an A1 waterfall to its first animation row at frame 3', () => {
    expect(computeAutotileQuarterOrigins(2288, 'A1', 3)).toEqual([
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

  it('uses the top-right cap quarter for A2 shape 17', () => {
    expect(computeAutotileQuarterOrigins(2816 + 17, 'A2')).toEqual([
      { x: 0, y: 96 },
      { x: 72, y: 0 },
      { x: 0, y: 72 },
      { x: 24, y: 72 },
    ]);
  });

  it('falls back to the first water frame for a negative A1 animation frame', () => {
    expect(computeAutotileQuarterOrigins(2048, 'A1', -1)).toEqual(
      computeAutotileQuarterOrigins(2048, 'A1', 0),
    );
  });

  describe('tilePixelSize (HD sheets)', () => {
    it('scales A2 kind 0 shape 0 quarter origins exactly 2× in pixels at 96px', () => {
      const at48 = computeAutotileQuarterOrigins(2816, 'A2', 0, 48);
      const at96 = computeAutotileQuarterOrigins(2816, 'A2', 0, 96);
      expect(at48).toEqual([
        { x: 48, y: 96 },
        { x: 24, y: 96 },
        { x: 48, y: 72 },
        { x: 24, y: 72 },
      ]);
      expect(at96).toEqual([
        { x: 96, y: 192 },
        { x: 48, y: 192 },
        { x: 96, y: 144 },
        { x: 48, y: 144 },
      ]);
      for (let i = 0; i < 4; i++) {
        expect(at96[i]?.x).toBe((at48[i]?.x ?? 0) * 2);
        expect(at96[i]?.y).toBe((at48[i]?.y ?? 0) * 2);
      }
    });

    it('defaults tilePixelSize to 48 (identical to the pre-parameterization path)', () => {
      expect(computeAutotileQuarterOrigins(2816, 'A2')).toEqual(
        computeAutotileQuarterOrigins(2816, 'A2', 0, 48),
      );
    });
  });
});
