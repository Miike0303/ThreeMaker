import type { RpgmMap, RpgmTileset } from '@threemaker/importer-rpgm';
import { describe, expect, it } from 'vitest';
import {
  computeDirtyChunkKeys,
  computeDirtyTileRect,
  dirtyRectToChunkKeys,
  expandDirtyRectNorthThroughStars,
} from '../src/dirty-region.js';

function makeTileset(starTileIds: readonly number[] = [2]): RpgmTileset {
  const flags = new Array(8192).fill(0);
  for (const id of starTileIds) flags[id] = 0x10; // star ("upper layer") bit
  return {
    id: 1,
    name: 'test',
    sheetNames: { A1: '', A2: '', A3: '', A4: '', A5: '', B: 'B', C: '', D: '', E: '' },
    flags,
  };
}

function makeMap(width: number, height: number, layer0: readonly number[]): RpgmMap {
  const size = width * height;
  return {
    id: 1,
    displayName: 'test',
    width,
    height,
    tilesetId: 1,
    scrollType: 0,
    layers: {
      tileLayers: [
        layer0,
        new Array(size).fill(0),
        new Array(size).fill(0),
        new Array(size).fill(0),
      ],
      shadows: new Array(size).fill(0),
      regions: new Array(size).fill(0),
    },
  };
}

describe('computeDirtyTileRect', () => {
  it('returns a zero-area rect for no touched cells', () => {
    expect(computeDirtyTileRect([], 10, 10)).toEqual({ xStart: 0, yStart: 0, xEnd: 0, yEnd: 0 });
  });

  it('expands a single touched cell by 1 tile on every side', () => {
    expect(computeDirtyTileRect([{ x: 5, y: 5 }], 10, 10)).toEqual({
      xStart: 4,
      yStart: 4,
      xEnd: 7,
      yEnd: 7,
    });
  });

  it('clamps the expansion to the map bounds', () => {
    expect(computeDirtyTileRect([{ x: 0, y: 0 }], 10, 10)).toEqual({
      xStart: 0,
      yStart: 0,
      xEnd: 2,
      yEnd: 2,
    });
    expect(computeDirtyTileRect([{ x: 9, y: 9 }], 10, 10)).toEqual({
      xStart: 8,
      yStart: 8,
      xEnd: 10,
      yEnd: 10,
    });
  });

  it('bounds a multi-cell stroke to its own bounding box + margin', () => {
    const cells = [
      { x: 2, y: 3 },
      { x: 5, y: 3 },
      { x: 3, y: 6 },
    ];
    expect(computeDirtyTileRect(cells, 20, 20)).toEqual({
      xStart: 1,
      yStart: 2,
      xEnd: 7,
      yEnd: 8,
    });
  });
});

describe('expandDirtyRectNorthThroughStars', () => {
  it('leaves the rect unchanged when there are no star tiles north of it', () => {
    const map = makeMap(4, 4, new Array(16).fill(1)); // all plain ground, no star tiles
    const tileset = makeTileset();
    const rect = { xStart: 0, yStart: 2, xEnd: 4, yEnd: 4 };
    expect(expandDirtyRectNorthThroughStars(rect, map, tileset)).toEqual(rect);
  });

  it('expands north through a contiguous run of star tiles in a touched column', () => {
    // Column x=1: rows 0,1 are star tiles, row 2 is the base (ground).
    const width = 4;
    const height = 4;
    const layer0 = new Array(width * height).fill(1);
    layer0[0 * width + 1] = 2; // (1,0) star
    layer0[1 * width + 1] = 2; // (1,1) star
    const map = makeMap(width, height, layer0);
    const tileset = makeTileset([2]);

    // Rect starts at yStart=2 (the base row), touching column x=1.
    const rect = { xStart: 1, yStart: 2, xEnd: 2, yEnd: 4 };
    const expanded = expandDirtyRectNorthThroughStars(rect, map, tileset);

    expect(expanded).toEqual({ xStart: 1, yStart: 0, xEnd: 2, yEnd: 4 });
  });

  it('expands independently per column, taking the minimum yStart across all touched columns', () => {
    const width = 4;
    const height = 5;
    const layer0 = new Array(width * height).fill(1);
    layer0[1 * width + 0] = 2; // column 0: 1 star row above y=2
    layer0[0 * width + 2] = 2; // column 2: star all the way to row 0
    layer0[1 * width + 2] = 2;
    const map = makeMap(width, height, layer0);
    const tileset = makeTileset([2]);

    const rect = { xStart: 0, yStart: 2, xEnd: 3, yEnd: 5 };
    const expanded = expandDirtyRectNorthThroughStars(rect, map, tileset);

    expect(expanded.yStart).toBe(0); // column 2's star run reaches the map's top edge
  });

  it('is a no-op for a zero-area rect', () => {
    const map = makeMap(4, 4, new Array(16).fill(0));
    const tileset = makeTileset();
    const rect = { xStart: 0, yStart: 0, xEnd: 0, yEnd: 0 };
    expect(expandDirtyRectNorthThroughStars(rect, map, tileset)).toEqual(rect);
  });
});

describe('dirtyRectToChunkKeys', () => {
  it('returns every chunk key the rect overlaps', () => {
    const rect = { xStart: 14, yStart: 0, xEnd: 18, yEnd: 1 };
    const keys = dirtyRectToChunkKeys(rect, 16);
    expect([...keys].sort()).toEqual(['0,0', '1,0']);
  });

  it('returns an empty set for a zero-area rect', () => {
    expect(dirtyRectToChunkKeys({ xStart: 0, yStart: 0, xEnd: 0, yEnd: 0 }, 16).size).toBe(0);
  });

  it('returns exactly one key for a rect fully inside one chunk', () => {
    const keys = dirtyRectToChunkKeys({ xStart: 2, yStart: 2, xEnd: 5, yEnd: 5 }, 16);
    expect([...keys]).toEqual(['0,0']);
  });
});

describe('computeDirtyChunkKeys (full pipeline)', () => {
  it('composes rect expansion + star expansion + chunk mapping for a single edited base tile', () => {
    const width = 32;
    const height = 32;
    const layer0 = new Array(width * height).fill(1);
    layer0[0 * width + 16] = 2; // star tile stacked directly above the edited cell
    const map = makeMap(width, height, layer0);
    const tileset = makeTileset([2]);

    // Edit the base tile at (16, 1) -- the star at (16,0) sits immediately north.
    const keys = computeDirtyChunkKeys([{ x: 16, y: 1 }], map, tileset, 16);

    // (16,1) +/-1 margin reaches y=0; the star at (16,0) is already inside
    // that margin here, but the north-expansion is exercised directly above.
    expect(keys.size).toBeGreaterThan(0);
  });

  it('a corner-to-corner stroke on a 64x64 map does not dirty interior chunk 1,1', () => {
    const width = 64;
    const height = 64;
    const map = makeMap(width, height, new Array(width * height).fill(1));
    const tileset = makeTileset();
    const keys = computeDirtyChunkKeys(
      [
        { x: 0, y: 0 },
        { x: 63, y: 63 },
      ],
      map,
      tileset,
      16,
    );

    expect(keys.has('1,1')).toBe(false);
    expect(keys.size).toBeLessThanOrEqual(8);
  });

  it('a cell on a chunk boundary still dirties the adjacent chunk', () => {
    const width = 64;
    const height = 64;
    const map = makeMap(width, height, new Array(width * height).fill(1));
    const tileset = makeTileset();
    const keys = computeDirtyChunkKeys([{ x: 16, y: 8 }], map, tileset, 16);

    expect(keys.has('0,0')).toBe(true);
    expect(keys.has('1,0')).toBe(true);
  });

  it('editing a base tile dirties star tiles stacked north of it in that column', () => {
    const width = 32;
    const height = 32;
    const layer0 = new Array(width * height).fill(1);
    // Contiguous star run in column 16 from the map top through row 15, so the
    // ±1 margin of the base at (16, 17) stays in chunk Y=1 and only the star
    // walk reaches chunk Y=0.
    for (let y = 0; y <= 15; y++) layer0[y * width + 16] = 2;
    const map = makeMap(width, height, layer0);
    const tileset = makeTileset([2]);

    const keys = computeDirtyChunkKeys([{ x: 16, y: 17 }], map, tileset, 16);

    expect(keys.has('1,0')).toBe(true);
  });

  it('a full-map fill dirties every chunk', () => {
    const width = 64;
    const height = 64;
    const map = makeMap(width, height, new Array(width * height).fill(1));
    const tileset = makeTileset();
    const cells: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        cells.push({ x, y });
      }
    }

    const keys = computeDirtyChunkKeys(cells, map, tileset, 16);
    const fullMapKeys = dirtyRectToChunkKeys(
      { xStart: 0, yStart: 0, xEnd: width, yEnd: height },
      16,
    );

    expect([...keys].sort()).toEqual([...fullMapKeys].sort());
  });

  it('interior fast path matches per-cell keys on a map with star tiles', () => {
    const width = 64;
    const height = 64;
    const chunkSize = 16;
    const layer0 = new Array(width * height).fill(1);
    // Contiguous star run that crosses a chunk boundary in one column.
    for (let y = 0; y <= 15; y++) layer0[y * width + 20] = 2;
    const map = makeMap(width, height, layer0);
    const tileset = makeTileset([2]);

    const perCellUnion = (cells: readonly { x: number; y: number }[]) => {
      const keys = new Set<string>();
      const minYByColumn = new Map<number, number>();
      for (const cell of cells) {
        const prev = minYByColumn.get(cell.x);
        if (prev === undefined || cell.y < prev) minYByColumn.set(cell.x, cell.y);
      }
      const expandedYStartByColumn = new Map<number, number>();
      for (const [x, minY] of minYByColumn) {
        const rect = computeDirtyTileRect([{ x, y: minY }], width, height);
        expandedYStartByColumn.set(x, expandDirtyRectNorthThroughStars(rect, map, tileset).yStart);
      }
      for (const cell of cells) {
        const rect = computeDirtyTileRect([cell], width, height);
        const expanded = {
          ...rect,
          yStart: expandedYStartByColumn.get(cell.x) ?? rect.yStart,
        };
        for (const key of dirtyRectToChunkKeys(expanded, chunkSize)) keys.add(key);
      }
      return keys;
    };

    const fillCells: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        fillCells.push({ x, y });
      }
    }
    const fillKeys = computeDirtyChunkKeys(fillCells, map, tileset, chunkSize);
    const fullMapKeys = dirtyRectToChunkKeys(
      { xStart: 0, yStart: 0, xEnd: width, yEnd: height },
      chunkSize,
    );
    expect([...fillKeys].sort()).toEqual([...fullMapKeys].sort());
    expect([...fillKeys].sort()).toEqual([...perCellUnion(fillCells)].sort());

    const diagonal: { x: number; y: number }[] = [];
    for (let i = 0; i < width; i++) diagonal.push({ x: i, y: i });
    const diagonalKeys = computeDirtyChunkKeys(diagonal, map, tileset, chunkSize);
    for (const cell of diagonal) {
      const ownKey = `${Math.floor(cell.x / chunkSize)},${Math.floor(cell.y / chunkSize)}`;
      expect(diagonalKeys.has(ownKey)).toBe(true);
    }
    expect([...diagonalKeys].sort()).toEqual([...perCellUnion(diagonal)].sort());
  });
});
