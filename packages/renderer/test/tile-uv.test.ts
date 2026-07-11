import { describe, expect, it } from 'vitest';
import { computeTileUv } from '../src/geometry/tile-uv.js';
import type { SheetPixelSizes } from '../src/geometry/types.js';

// A B/C/D/E-style sheet: 768x768px = 16x16 tiles of 48px (real Roseliam
// fixture Inside_B.png / Inside_C.png dimensions).
const GRID_SHEET_SIZES: SheetPixelSizes = {
  B: { width: 768, height: 768 },
};

// An A1/A2/A4-style autotile sheet: 768x576px = 16x12 tiles of 48px (real
// Roseliam fixture Dungeon_A1.png / Dungeon_A2.png dimensions).
const AUTOTILE_SHEET_SIZES: SheetPixelSizes = {
  A1: { width: 768, height: 576 },
  A2: { width: 768, height: 576 },
};

describe('computeTileUv', () => {
  it('returns null for tile id 0 (empty tile)', () => {
    expect(computeTileUv(0, GRID_SHEET_SIZES)).toBeNull();
  });

  it('returns null when the sheet for the tile id has no known pixel size', () => {
    // Tile id 5 belongs to sheet B, but only A1 pixel size is provided.
    expect(computeTileUv(5, AUTOTILE_SHEET_SIZES)).toBeNull();
  });

  it('maps a plain (non-autotile) tile id to a single full-tile UV quad', () => {
    const result = computeTileUv(1, GRID_SHEET_SIZES);
    expect(result?.sheet).toBe('B');
    expect(result?.quads).toHaveLength(1);
    // col=1, row=0 -> pixel x=48..96, y=0..48 -> u=[0.0625, 0.125], v flipped: [1 - 48/768, 1 - 0/768]
    expect(result?.quads[0]?.u0).toBeCloseTo(48 / 768);
    expect(result?.quads[0]?.u1).toBeCloseTo(96 / 768);
    expect(result?.quads[0]?.v0).toBeCloseTo(1 - 48 / 768);
    expect(result?.quads[0]?.v1).toBeCloseTo(1);
  });

  it('maps local index 16 to the third row of the left 8-wide block, not a 16-wide row', () => {
    // RPG Maker B-E sheets are addressed as two side-by-side 8-column
    // blocks (corescript `Tilemap._addNormalTile`), NOT one 16-column grid:
    // ids 0-127 fill the left block top-to-bottom, ids 128-255 the right.
    // Local index 16 = left block, col 0, row 2.
    const result = computeTileUv(16, GRID_SHEET_SIZES);
    expect(result?.sheet).toBe('B');
    expect(result?.quads[0]?.u0).toBeCloseTo(0);
    expect(result?.quads[0]?.u1).toBeCloseTo(48 / 768);
    expect(result?.quads[0]?.v0).toBeCloseTo(1 - 144 / 768);
    expect(result?.quads[0]?.v1).toBeCloseTo(1 - 96 / 768);
  });

  it('maps B tile 77 to corescript cell (240,432) -- the Map007 dark-diamond regression', () => {
    // Root cause of the "dark diamonds near the Map007 bridges" bug: with a
    // naive 16-wide grid, id 77 lands on cell (624,192) -- a small, mostly
    // black decor sprite -- instead of the light pedestal-base art at
    // (240,432) that RPG Maker draws (sx=((77/128|0)%2*8+77%8)*48=240,
    // sy=(77/8|0)%16*48=432).
    const result = computeTileUv(77, GRID_SHEET_SIZES);
    expect(result?.quads[0]?.u0).toBeCloseTo(240 / 768);
    expect(result?.quads[0]?.u1).toBeCloseTo(288 / 768);
    expect(result?.quads[0]?.v0).toBeCloseTo(1 - 480 / 768);
    expect(result?.quads[0]?.v1).toBeCloseTo(1 - 432 / 768);
  });

  it('maps ids 128+ into the right 8-wide block of a B-E sheet', () => {
    // Local index 130 = right block (128+), col 8+2=10, row 0.
    const result = computeTileUv(130, GRID_SHEET_SIZES);
    expect(result?.quads[0]?.u0).toBeCloseTo(480 / 768);
    expect(result?.quads[0]?.u1).toBeCloseTo(528 / 768);
    expect(result?.quads[0]?.v0).toBeCloseTo(1 - 48 / 768);
    expect(result?.quads[0]?.v1).toBeCloseTo(1);
  });

  it('maps A5 tiles onto its single 8-wide block', () => {
    // A5 ids start at 1536; local index 9 = col 1, row 1 of the 8x16 sheet.
    const result = computeTileUv(1536 + 9, { A5: { width: 384, height: 768 } });
    expect(result?.sheet).toBe('A5');
    expect(result?.quads[0]?.u0).toBeCloseTo(48 / 384);
    expect(result?.quads[0]?.u1).toBeCloseTo(96 / 384);
    expect(result?.quads[0]?.v0).toBeCloseTo(1 - 96 / 768);
    expect(result?.quads[0]?.v1).toBeCloseTo(1 - 48 / 768);
  });

  it('maps an autotile id to 4 quarter-tile UV quads, not 1 repeated rect', () => {
    // Tile id 2816 is the first A2 autotile id (global kind 16, local kind 0,
    // shape 0). See autotile-tables.test.ts for the pixel-origin derivation:
    // bx=0, by=0, FLOOR_AUTOTILE_TABLE[0] -> quarters at
    // (48,96) (24,96) (48,72) (24,72), each 24x24px, sheet 768x576.
    const result = computeTileUv(2816, AUTOTILE_SHEET_SIZES);
    expect(result?.sheet).toBe('A2');
    expect(result?.quads).toHaveLength(4);

    const [q0, q1, q2, q3] = result?.quads ?? [];
    expect(q0?.u0).toBeCloseTo(48 / 768);
    expect(q0?.u1).toBeCloseTo(72 / 768);
    expect(q0?.v0).toBeCloseTo(1 - 120 / 576);
    expect(q0?.v1).toBeCloseTo(1 - 96 / 576);

    expect(q1?.u0).toBeCloseTo(24 / 768);
    expect(q1?.u1).toBeCloseTo(48 / 768);

    expect(q2?.v0).toBeCloseTo(1 - 96 / 576);
    expect(q2?.v1).toBeCloseTo(1 - 72 / 576);

    expect(q3?.u0).toBeCloseTo(24 / 768);
    expect(q3?.v0).toBeCloseTo(1 - 96 / 576);
  });

  it('gives different shapes of the same autotile kind different quads (real blob-tile blending, not the old flat repeat)', () => {
    // shape 0 (fully-connected interior) vs shape 47 (fully-isolated) of the
    // same A2 kind must resolve to visually different quarter tiles.
    const shape0 = computeTileUv(2816, AUTOTILE_SHEET_SIZES);
    const shape47 = computeTileUv(2816 + 47, AUTOTILE_SHEET_SIZES);
    expect(shape47?.quads).not.toEqual(shape0?.quads);
  });
});
