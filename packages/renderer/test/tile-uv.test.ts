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
};

describe('computeTileUv', () => {
  it('returns null for tile id 0 (empty tile)', () => {
    expect(computeTileUv(0, GRID_SHEET_SIZES)).toBeNull();
  });

  it('returns null when the sheet for the tile id has no known pixel size', () => {
    // Tile id 5 belongs to sheet B, but only A1 pixel size is provided.
    expect(computeTileUv(5, AUTOTILE_SHEET_SIZES)).toBeNull();
  });

  it('maps tile id 1 (sheet B, local index 1) to the second column of the top row', () => {
    const result = computeTileUv(1, GRID_SHEET_SIZES);
    expect(result?.sheet).toBe('B');
    // col=1, row=0 -> pixel x=48..96, y=0..48 -> u=[0.0625, 0.125], v flipped: [1 - 48/768, 1 - 0/768]
    expect(result?.uv.u0).toBeCloseTo(48 / 768);
    expect(result?.uv.u1).toBeCloseTo(96 / 768);
    expect(result?.uv.v0).toBeCloseTo(1 - 48 / 768);
    expect(result?.uv.v1).toBeCloseTo(1);
  });

  it('maps a tile id at the start of the second row (local index 16) to row 1', () => {
    const result = computeTileUv(16, GRID_SHEET_SIZES);
    expect(result?.sheet).toBe('B');
    expect(result?.uv.u0).toBeCloseTo(0);
    expect(result?.uv.u1).toBeCloseTo(48 / 768);
    expect(result?.uv.v0).toBeCloseTo(1 - 96 / 768);
    expect(result?.uv.v1).toBeCloseTo(1 - 48 / 768);
  });

  it('maps an autotile id (A1, first kind) to the top-left representative sub-tile of its block', () => {
    // Tile id 2048 is the first A1 autotile id -> global kind 0 -> local kind 0
    // -> block (col 0, row 0) -> representative sub-tile at pixel (0,0).
    const result = computeTileUv(2048, AUTOTILE_SHEET_SIZES);
    expect(result?.sheet).toBe('A1');
    expect(result?.uv.u0).toBeCloseTo(0);
    expect(result?.uv.u1).toBeCloseTo(48 / 768);
    expect(result?.uv.v0).toBeCloseTo(1 - 48 / 576);
    expect(result?.uv.v1).toBeCloseTo(1);
  });

  it('maps a later autotile id within the same kind (any of the 48 shape ids) to the same representative sub-tile', () => {
    // ids 2048..2095 all belong to kind 0 (48 ids per kind) -- the simplified
    // slice renders all 48 shape variants identically.
    const first = computeTileUv(2048, AUTOTILE_SHEET_SIZES);
    const last = computeTileUv(2095, AUTOTILE_SHEET_SIZES);
    expect(last?.uv).toEqual(first?.uv);
  });

  it('maps the second A1 kind (local kind 1) one block-width (2 tiles = 96px) to the right', () => {
    // Tile id 2048 + 48 = 2096 -> global kind 1 -> local kind 1 (still within A1's
    // own kind-offset range of 0) -> block col 1 -> pixel x = 96.
    const result = computeTileUv(2096, AUTOTILE_SHEET_SIZES);
    expect(result?.uv.u0).toBeCloseTo(96 / 768);
    expect(result?.uv.u1).toBeCloseTo(144 / 768);
  });

  it('wraps to the next block-row once a sheet row of kind-blocks is filled', () => {
    // Sheet width 768px / (2 tiles * 48px) = 8 block-columns per row.
    // Local kind 8 -> block row 1, block col 0 -> pixel y = 3 tiles * 48px = 144.
    const result = computeTileUv(2048 + 8 * 48, AUTOTILE_SHEET_SIZES);
    expect(result?.uv.v0).toBeCloseTo(1 - (144 + 48) / 576);
    expect(result?.uv.v1).toBeCloseTo(1 - 144 / 576);
  });
});
