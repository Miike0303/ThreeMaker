import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TilePalette } from '../src/components/TilePalette.js';
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
  it('caps an oversized A5 palette at thirty-two rows', () => {
    expect(computePlainGridDimensions('A5', { width: 384, height: 33 * 48 })).toEqual({
      cols: 8,
      rows: 32,
    });
  });

  it('omits an incomplete second row from a plain sheet', () => {
    expect(computePlainGridDimensions('B', { width: 48, height: 95 })).toEqual({
      cols: 1,
      rows: 1,
    });
  });

  it('omits an incomplete second column from a plain sheet', () => {
    expect(computePlainGridDimensions('B', { width: 95, height: 48 })).toEqual({
      cols: 1,
      rows: 1,
    });
  });

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

  it('keeps the lower half of a tall A5 sheet available', () => {
    expect(computePlainGridDimensions('A5', { width: 384, height: 1536 }).rows).toBe(32);
  });

  it('never reports fewer than 1 col/row for a degenerate (near-zero) pixel size', () => {
    expect(computePlainGridDimensions('B', { width: 1, height: 1 })).toEqual({ cols: 1, rows: 1 });
  });

  it('matches cell count for a 96px sheet with tilePixelSize 96 vs a 48px sheet with 48', () => {
    // Same logical 16×16 tile grid: 768@48 and 1536@96 must yield the same
    // cols/rows (and therefore the same clickable cell count).
    const at48 = computePlainGridDimensions('B', { width: 768, height: 768 }, 48);
    const at96 = computePlainGridDimensions('B', { width: 1536, height: 1536 }, 96);
    expect(at96).toEqual(at48);
    expect(at96).toEqual({ cols: 16, rows: 16 });
    expect(computePaletteCells('B', { width: 1536, height: 1536 }, 96)).toHaveLength(
      computePaletteCells('B', { width: 768, height: 768 }, 48).length,
    );
  });

  it('sizes palette cell pixel rects with the document tilePixelSize', () => {
    const cells = computePaletteCells('B', { width: 1536, height: 1536 }, 96);
    const cell = cells.find((c) => c.tileId === 77);
    // Same logical cell as the 48px Map007 regression, scaled 2× in pixels.
    expect(cell).toEqual({ tileId: 77, x: 480, y: 864, width: 96, height: 96 });
  });
});

describe('computePaletteCells - plain sheets (B/C/D/E/A5)', () => {
  it('omits a seventeenth plain-sheet column that would repeat tile ids', () => {
    const cells = computePaletteCells('B', { width: 17 * 48, height: 48 });
    expect(cells.map((cell) => cell.tileId)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 128, 129, 130, 131, 132, 133, 134, 135,
    ]);
  });

  it('caps a tall E palette at its final addressable tile', () => {
    const cells = computePaletteCells('E', { width: 768, height: 1536 });
    expect(cells).toHaveLength(256);
    expect(cells.at(-1)?.tileId).toBe(1023);
    expect(cells.every((cell) => cell.tileId >= 768 && cell.tileId < 1024)).toBe(true);
  });

  it('caps a tall D palette before its tile ids reach the E sheet', () => {
    const cells = computePaletteCells('D', { width: 768, height: 1536 });
    expect(cells).toHaveLength(256);
    expect(cells.at(-1)?.tileId).toBe(767);
    expect(cells.every((cell) => cell.tileId >= 512 && cell.tileId < 768)).toBe(true);
  });

  it('caps a tall C palette before its tile ids reach the D sheet', () => {
    const cells = computePaletteCells('C', { width: 768, height: 1536 });
    expect(cells).toHaveLength(256);
    expect(cells.at(-1)?.tileId).toBe(511);
    expect(cells.every((cell) => cell.tileId >= 256 && cell.tileId < 512)).toBe(true);
  });

  it('selects the first tile of the right block without spilling into the next sheet', () => {
    const cells = computePaletteCells('B', { width: 768, height: 48 });
    expect(cells[8]).toEqual({ tileId: 128, x: 384, y: 0, width: 48, height: 48 });
  });

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
  it('scales an autotile swatch origin to the authored tile pixel size', () => {
    const cells = computePaletteCells('A2', { width: 1536, height: 1152 }, 96);
    expect(cells[0]).toEqual({ tileId: 2816, x: 48, y: 144, width: 96, height: 96 });
  });

  it('keeps the last A2 kind selectable on a full sheet', () => {
    const cells = computePaletteCells('A2', { width: 768, height: 576 });
    expect(cells).toHaveLength(32);
    expect(cells.at(-1)?.tileId).toBe(4304);
  });

  it('exposes the last A3 kind on a full four-row sheet', () => {
    const cells = computePaletteCells('A3', { width: 768, height: 384 });
    expect(cells).toHaveLength(32);
    expect(cells.at(-1)?.tileId).toBe(5840);
  });

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
  it('keeps one autotile row selectable when the image is shorter than a kind row', () => {
    expect(computeAutotileKindCount('A2', { width: 768, height: 143 })).toBe(8);
  });

  it('exposes both A3 kind rows when the sheet is four tiles tall', () => {
    expect(computeAutotileKindCount('A3', { width: 768, height: 192 })).toBe(16);
  });

  it('omits the incomplete second row of autotile kinds', () => {
    expect(computeAutotileKindCount('A2', { width: 768, height: 287 })).toBe(8);
  });

  it('keeps all 48 A4 kinds available on a tall sheet', () => {
    expect(computeAutotileKindCount('A4', { width: 768, height: 720 })).toBe(48);
  });

  it('counts both alternating A4 kind rows at their average height', () => {
    expect(computeAutotileKindCount('A4', { width: 768, height: 240 })).toBe(16);
  });

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

describe('TilePalette', () => {
  it('labels the swatch grid with its visible sheet label', () => {
    const markup = renderToStaticMarkup(
      createElement(TilePalette, {
        label: 'B palette',
        sheet: 'B',
        imageUrl: 'sheet.png',
        pixelSize: { width: 96, height: 48 },
        tilePixelSize: 48,
        selectedTileId: -1,
        onSelect: () => {},
        tileAriaLabel: (tileId: number) => `tile ${tileId}`,
      }),
    );
    const labelId = markup.match(/<p id="([^"]+)" class="tile-palette-label">B palette<\/p>/)?.[1];

    expect(labelId).toBeDefined();
    expect(markup).toContain(`<div class="tile-palette" role="group" aria-labelledby="${labelId}"`);
  });

  it('uses different label ids for palettes rendered in one tree', () => {
    const palette = (label: string) =>
      createElement(TilePalette, {
        label,
        sheet: 'B',
        imageUrl: 'sheet.png',
        pixelSize: { width: 96, height: 48 },
        tilePixelSize: 48,
        selectedTileId: -1,
        onSelect: () => {},
        tileAriaLabel: (tileId: number) => `tile ${tileId}`,
      });
    const markup = renderToStaticMarkup(
      createElement('div', null, palette('B palette'), palette('C palette')),
    );
    const labelIds = [...markup.matchAll(/<p id="([^"]+)" class="tile-palette-label">/g)].map(
      (match) => match[1],
    );

    expect(labelIds).toHaveLength(2);
    expect(labelIds[0]).not.toBe(labelIds[1]);
  });

  it('exposes only the selected tile as pressed to assistive technology', () => {
    const cells = computePaletteCells('B', { width: 96, height: 48 }, 48);
    const selected = cells[1]?.tileId ?? -1;
    const markup = renderToStaticMarkup(
      createElement(TilePalette, {
        label: 'B palette',
        sheet: 'B',
        imageUrl: 'sheet.png',
        pixelSize: { width: 96, height: 48 },
        tilePixelSize: 48,
        selectedTileId: selected,
        onSelect: () => {},
        tileAriaLabel: (tileId: number) => `tile ${tileId}`,
      }),
    );

    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(cells.length - 1);
    expect(markup).toContain(`aria-label="tile ${selected}" aria-pressed="true"`);
  });
});
