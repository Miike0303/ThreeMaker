import { describe, expect, it } from 'vitest';
import {
  computeAutotileKindCount,
  computePaletteCells,
  computePaletteColumns,
  computePlainGridDimensions,
  isPlainSheet,
  resolveAutotileKindTileId,
} from '../src/tile-palette.js';

// Gate-review REQUIRED FEATURE: a visual, clickable tileset-image palette
// ("como en RPG Maker") -- these are the pure pixel/grid<->tile-id helpers
// behind it. See packages/renderer/src/geometry/tile-uv.ts (plain-sheet grid
// addressing) and packages/renderer/test/autotile-tables.test.ts (autotile
// kind addressing) for the exact known-good cases these tests cross-check
// against.

describe('isPlainSheet', () => {
  it('is true for the plain grid sheets (B/C/D/E/A5)', () => {
    expect(isPlainSheet('B')).toBe(true);
    expect(isPlainSheet('C')).toBe(true);
    expect(isPlainSheet('D')).toBe(true);
    expect(isPlainSheet('E')).toBe(true);
    expect(isPlainSheet('A5')).toBe(true);
  });

  it('is false for the autotile sheets (A1-A4)', () => {
    expect(isPlainSheet('A1')).toBe(false);
    expect(isPlainSheet('A2')).toBe(false);
    expect(isPlainSheet('A3')).toBe(false);
    expect(isPlainSheet('A4')).toBe(false);
  });
});

describe('computePlainGridDimensions', () => {
  it('derives cols/rows from the real loaded image pixel size, capped at 16 cols (two 8-col blocks)', () => {
    expect(computePlainGridDimensions('B', { width: 768, height: 768 })).toEqual({
      cols: 16,
      rows: 16,
    });
  });

  it('caps rows at the sheets own valid id range even for an unusually tall image', () => {
    // B's range is only 256 ids -> 16 rows max at 16 cols, regardless of a
    // taller real PNG.
    expect(computePlainGridDimensions('B', { width: 768, height: 100000 }).rows).toBe(16);
  });

  it('never reports fewer than 1 col/row for a degenerate (near-zero) pixel size', () => {
    expect(computePlainGridDimensions('B', { width: 1, height: 1 })).toEqual({ cols: 1, rows: 1 });
  });
});

describe('computePaletteCells - plain sheets (B/C/D/E/A5)', () => {
  it('resolves the documented "Map007 dark diamond" regression case: B tile 77 sits at pixel (240,432)', () => {
    // Mirrors packages/renderer/src/geometry/tile-uv.ts's computeGridUv
    // doc comment exactly -- same known-good case, inverted (pixel -> id
    // instead of id -> pixel).
    const cells = computePaletteCells('B', { width: 768, height: 768 });
    const cell = cells.find((c) => c.tileId === 77);
    expect(cell).toEqual({ tileId: 77, x: 240, y: 432, width: 48, height: 48 });
  });

  it('produces exactly cols*rows cells, offset by the sheets own base id (C starts at 256)', () => {
    const cells = computePaletteCells('C', { width: 768, height: 384 });
    expect(cells).toHaveLength(16 * 8);
    expect(cells[0]).toEqual({ tileId: 256, x: 0, y: 0, width: 48, height: 48 });
  });

  it('A5 uses the same grid math with base id 1536, naturally folding away the right block on a narrower real image', () => {
    const cells = computePaletteCells('A5', { width: 384, height: 384 }); // 8 real cols
    expect(cells.every((c) => c.tileId >= 1536)).toBe(true);
    expect(cells[0]).toEqual({ tileId: 1536, x: 0, y: 0, width: 48, height: 48 });
  });
});

describe('computePaletteCells - autotile sheets (A1-A4)', () => {
  it('A2 kind 0 (shape 0, base tile 2816) crops from the same swatch origin autotile-tables.test.ts pins for that tile', () => {
    const cells = computePaletteCells('A2', { width: 768, height: 768 });
    expect(cells[0]).toEqual({ tileId: 2816, x: 24, y: 72, width: 48, height: 48 });
  });

  it('A2 kind 1 is the next kind along the row (base tile 2864)', () => {
    const cells = computePaletteCells('A2', { width: 768, height: 768 });
    expect(cells[1]?.tileId).toBe(2864);
  });

  it('A3 uses the wall-autotile addressing (kind 0 base tile 4352, different swatch origin than A2)', () => {
    const cells = computePaletteCells('A3', { width: 768, height: 480 });
    expect(cells[0]).toEqual({ tileId: 4352, x: 24, y: 24, width: 48, height: 48 });
  });

  it('caps A1 at the standard single 8-kind water+waterfall row even for a very tall image', () => {
    const cells = computePaletteCells('A1', { width: 768, height: 2000 });
    expect(cells).toHaveLength(8);
    expect(cells[0]?.tileId).toBe(2048);
  });

  it('never produces a tile id beyond a sheets own valid range, even for a very tall image', () => {
    const cells = computePaletteCells('A2', { width: 768, height: 100000 });
    expect(cells.every((c) => c.tileId >= 2816 && c.tileId < 4352)).toBe(true);
  });
});

describe('computeAutotileKindCount', () => {
  it('grows with real image height for A2 (3 tiles per kind-row)', () => {
    expect(computeAutotileKindCount('A2', { width: 768, height: 144 })).toBe(8); // 1 row
    expect(computeAutotileKindCount('A2', { width: 768, height: 288 })).toBe(16); // 2 rows
  });
});

describe('resolveAutotileKindTileId', () => {
  it('maps kind index to base id (shape 0) per sheet', () => {
    expect(resolveAutotileKindTileId('A2', 0)).toBe(2816);
    expect(resolveAutotileKindTileId('A3', 0)).toBe(4352);
    expect(resolveAutotileKindTileId('A1', 0)).toBe(2048);
  });
});

describe('computePaletteColumns', () => {
  it('matches the pixel grid column count for plain sheets', () => {
    expect(computePaletteColumns('B', { width: 768, height: 768 })).toBe(16);
  });

  it('is always 8 for autotile sheets (kinds per row)', () => {
    expect(computePaletteColumns('A2', { width: 768, height: 768 })).toBe(8);
  });
});
