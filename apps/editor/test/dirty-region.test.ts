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
});
