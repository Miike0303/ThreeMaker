import type { RpgmMap, RpgmTileset } from '@threemaker/importer-rpgm';
import { describe, expect, it } from 'vitest';
import { buildChunks } from '../src/geometry/chunk-geometry.js';
import type { SheetPixelSizes } from '../src/geometry/types.js';

const SHEET_SIZES: SheetPixelSizes = {
  B: { width: 768, height: 768 },
};

function makeTileset(overrides: Partial<RpgmTileset> = {}): RpgmTileset {
  const flags = new Array(8192).fill(0);
  // tile id 2 (sheet B, local index 2) is flagged upper-layer ("star" bit).
  flags[2] = 0x10;
  return {
    id: 1,
    name: 'test',
    sheetNames: { A1: '', A2: '', A3: '', A4: '', A5: '', B: 'B', C: '', D: '', E: '' },
    flags,
    ...overrides,
  };
}

function makeMap(overrides: Partial<RpgmMap> = {}): RpgmMap {
  const width = 4;
  const height = 4;
  const empty = new Array(width * height).fill(0);
  return {
    id: 1,
    displayName: 'test map',
    width,
    height,
    tilesetId: 1,
    scrollType: 0,
    layers: {
      tileLayers: [empty.slice(), empty.slice(), empty.slice(), empty.slice()],
      shadows: empty.slice(),
      regions: empty.slice(),
    },
    ...overrides,
  };
}

describe('buildChunks elevation (region-derived height)', () => {
  it('omits height from a ground-level tile (region 0) but reports it for an elevated one', () => {
    const width = 2;
    const height = 1;
    const layer0 = [1, 1];
    const regions = [0, 3];
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [layer0, new Array(2).fill(0), new Array(2).fill(0), new Array(2).fill(0)],
        shadows: new Array(2).fill(0),
        regions,
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);
    const tiles = chunks[0]?.tiles ?? [];
    const groundTile = tiles.find((tile) => tile.tileX === 0);
    const elevatedTile = tiles.find((tile) => tile.tileX === 1);

    expect(groundTile?.height ?? 0).toBe(0);
    expect(elevatedTile?.height).toBe(3);
  });

  it('attaches cliffEdges to a layer-0 ground tile whose neighbor is lower, and omits it otherwise', () => {
    // 3x3 grid: middle row is (ground, elevated, elevated); top/bottom rows
    // match the elevated columns' height, so only east/west edges are cliffs
    // (north/south neighbors are in-bounds and same height, isolating the
    // check from the map-boundary-is-ground-0 rule exercised elsewhere).
    const width = 3;
    const height = 3;
    // biome-ignore format: readability as a grid
    const layer0 = [
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
    ];
    // biome-ignore format: readability as a grid
    const regions = [
      0, 2, 2,
      0, 2, 2,
      0, 2, 2,
    ];
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [layer0, new Array(9).fill(0), new Array(9).fill(0), new Array(9).fill(0)],
        shadows: new Array(9).fill(0),
        regions,
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);
    const tiles = chunks[0]?.tiles ?? [];
    const findAt = (x: number, y: number) =>
      tiles.find((tile) => tile.tileX === x && tile.tileY === y);

    expect(findAt(0, 1)?.cliffEdges ?? []).toEqual([]); // ground itself: no cliff
    expect(findAt(1, 1)?.cliffEdges).toEqual([{ edge: 'west', neighborHeight: 0 }]);
    // (2,1) is bordered by the same-height (1,1) to the west and the map
    // edge (treated as ground, height 0) to the east.
    expect(findAt(2, 1)?.cliffEdges).toEqual([{ edge: 'east', neighborHeight: 0 }]);
  });

  it('does not attach cliffEdges to an "upper" (star-bit) tile even when elevated', () => {
    // tile id 2 is flagged upper-layer in makeTileset(); give it a region.
    const width = 1;
    const height = 1;
    const layer0 = [2];
    const regions = [3];
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [layer0, new Array(1).fill(0), new Array(1).fill(0), new Array(1).fill(0)],
        shadows: new Array(1).fill(0),
        regions,
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);
    const tile = chunks[0]?.tiles[0];

    expect(tile?.elevation).toBe('upper');
    expect(tile?.height).toBe(3);
    expect(tile?.cliffEdges).toBeUndefined();
  });
});

describe('buildChunks star-tile stacking (MV3D "tileoffset" fix)', () => {
  it('anchors an isolated star tile one row south of it, at level 0', () => {
    // tile id 2 is the flagged star tile; id 1 is a plain ground tile.
    const width = 1;
    const height = 2;
    const layer0 = [2, 1]; // (0,0) star, (0,1) ground base
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [layer0, new Array(2).fill(0), new Array(2).fill(0), new Array(2).fill(0)],
        shadows: new Array(2).fill(0),
        regions: new Array(2).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);
    const star = chunks[0]?.tiles.find((tile) => tile.tileY === 0);

    expect(star?.elevation).toBe('upper');
    expect(star?.starStack).toEqual({
      baseTileY: 1,
      level: 0,
      baseHeight: 0,
      baseIsWall: false,
    });
  });

  it('stacks two consecutive star tiles onto the same base, incrementing level going north', () => {
    const width = 1;
    const height = 3;
    const layer0 = [2, 2, 1]; // (0,0) and (0,1) star, (0,2) ground base
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [layer0, new Array(3).fill(0), new Array(3).fill(0), new Array(3).fill(0)],
        shadows: new Array(3).fill(0),
        regions: new Array(3).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);
    const tiles = chunks[0]?.tiles ?? [];
    const top = tiles.find((tile) => tile.tileY === 0);
    const middle = tiles.find((tile) => tile.tileY === 1);

    expect(top?.starStack).toEqual({ baseTileY: 2, level: 1, baseHeight: 0, baseIsWall: false });
    expect(middle?.starStack).toEqual({ baseTileY: 2, level: 0, baseHeight: 0, baseIsWall: false });
  });

  it('reports the base tile as a wall and picks up its region height when the base is an A3/A4 autotile', () => {
    const width = 1;
    const height = 2;
    const wallTileId = 5888; // first A3 id -- an autotile kind/shape, but getTileSheet only cares about the id range
    const layer0 = [2, wallTileId];
    const regions = [0, 3];
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [layer0, new Array(2).fill(0), new Array(2).fill(0), new Array(2).fill(0)],
        shadows: new Array(2).fill(0),
        regions,
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);
    const star = chunks[0]?.tiles.find((tile) => tile.tileY === 0);

    expect(star?.starStack).toEqual({
      baseTileY: 1,
      level: 0,
      baseHeight: 3,
      baseIsWall: true,
    });
  });

  it('treats the southern map edge as a level-0, height-0 base when a star tile has no tile below it', () => {
    const width = 1;
    const height = 1;
    const layer0 = [2];
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [layer0, new Array(1).fill(0), new Array(1).fill(0), new Array(1).fill(0)],
        shadows: new Array(1).fill(0),
        regions: new Array(1).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);
    const star = chunks[0]?.tiles[0];

    expect(star?.starStack).toEqual({
      baseTileY: 1, // == map.height: off-map
      level: 0,
      baseHeight: 0,
      baseIsWall: false,
    });
  });

  it('does not attach starStack to a ground tile', () => {
    const layer0 = new Array(16).fill(0);
    layer0[0] = 1; // plain ground, not the flagged star id
    const map = makeMap({
      layers: {
        tileLayers: [layer0, new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0)],
        shadows: new Array(16).fill(0),
        regions: new Array(16).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);

    expect(chunks[0]?.tiles[0]?.starStack).toBeUndefined();
  });
});

describe('buildChunks', () => {
  it('returns no chunks for an all-empty map', () => {
    const chunks = buildChunks(makeMap(), makeTileset(), SHEET_SIZES);
    expect(chunks).toEqual([]);
  });

  it('places a single ground tile into the chunk covering its coordinates', () => {
    const layer0 = new Array(16).fill(0);
    layer0[0] = 1; // (x=0, y=0), sheet B, ground (no flag)
    const map = makeMap({
      layers: {
        tileLayers: [layer0, new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0)],
        shadows: new Array(16).fill(0),
        regions: new Array(16).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.chunkX).toBe(0);
    expect(chunks[0]?.chunkY).toBe(0);
    expect(chunks[0]?.tiles).toHaveLength(1);
    expect(chunks[0]?.tiles[0]).toMatchObject({
      tileX: 0,
      tileY: 0,
      layerIndex: 0,
      sheet: 'B',
      elevation: 'ground',
    });
  });

  it('classifies a tile with the star bit set as "upper" elevation', () => {
    const layer0 = new Array(16).fill(0);
    layer0[0] = 2; // flagged upper-layer in makeTileset()
    const map = makeMap({
      layers: {
        tileLayers: [layer0, new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0)],
        shadows: new Array(16).fill(0),
        regions: new Array(16).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);

    expect(chunks[0]?.tiles[0]?.elevation).toBe('upper');
  });

  it('splits tiles across chunk boundaries using the given chunk size', () => {
    const width = 4;
    const height = 4;
    const layer0 = new Array(width * height).fill(0);
    layer0[0] = 1; // (0,0) -> chunk (0,0) with chunkSize=2
    layer0[3] = 1; // (3,0) -> chunk (1,0) with chunkSize=2
    layer0[2 * width + 2] = 1; // (2,2) -> chunk (1,1)
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [
          layer0,
          new Array(width * height).fill(0),
          new Array(width * height).fill(0),
          new Array(width * height).fill(0),
        ],
        shadows: new Array(width * height).fill(0),
        regions: new Array(width * height).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 2);

    const keys = chunks.map((chunk) => `${chunk.chunkX},${chunk.chunkY}`).sort();
    expect(keys).toEqual(['0,0', '1,0', '1,1']);
  });

  it('skips tiles whose sheet has no known pixel size', () => {
    const layer0 = new Array(16).fill(0);
    layer0[0] = 300; // sheet C, but SHEET_SIZES only has B
    const map = makeMap({
      layers: {
        tileLayers: [layer0, new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0)],
        shadows: new Array(16).fill(0),
        regions: new Array(16).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);

    expect(chunks).toEqual([]);
  });

  it('throws for a non-positive chunk size', () => {
    expect(() => buildChunks(makeMap(), makeTileset(), SHEET_SIZES, 0)).toThrow();
    expect(() => buildChunks(makeMap(), makeTileset(), SHEET_SIZES, -4)).toThrow();
  });

  it('emits no shadow data when the shadow layer is all zero', () => {
    const layer0 = new Array(16).fill(0);
    layer0[0] = 1;
    const map = makeMap({
      layers: {
        tileLayers: [layer0, new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0)],
        shadows: new Array(16).fill(0),
        regions: new Array(16).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);

    expect(chunks[0]?.shadows ?? []).toHaveLength(0);
  });

  it('emits one shadow entry per tile with a nonzero shadow-pencil bitmask', () => {
    const layer0 = new Array(16).fill(0);
    layer0[0] = 1;
    const shadows = new Array(16).fill(0);
    shadows[1 * 4 + 1] = 5; // (1,1): upper-left + lower-left quarters
    const map = makeMap({
      layers: {
        tileLayers: [layer0, new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0)],
        shadows,
        regions: new Array(16).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);

    expect(chunks[0]?.shadows).toEqual([{ tileX: 1, tileY: 1, mask: 5 }]);
  });

  it('creates a chunk for a shadow on an area with no tiles at all', () => {
    const shadows = new Array(16).fill(0);
    shadows[0] = 15;
    const map = makeMap({
      layers: {
        tileLayers: [
          new Array(16).fill(0),
          new Array(16).fill(0),
          new Array(16).fill(0),
          new Array(16).fill(0),
        ],
        shadows,
        regions: new Array(16).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.tiles).toHaveLength(0);
    expect(chunks[0]?.shadows).toEqual([{ tileX: 0, tileY: 0, mask: 15 }]);
  });

  it('assigns shadows to the chunk covering their tile coordinates', () => {
    const width = 4;
    const height = 4;
    const size = width * height;
    const shadows = new Array(size).fill(0);
    shadows[2 * width + 3] = 3; // (3,2) -> chunk (1,1) with chunkSize=2
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [
          new Array(size).fill(0),
          new Array(size).fill(0),
          new Array(size).fill(0),
          new Array(size).fill(0),
        ],
        shadows,
        regions: new Array(size).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 2);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.chunkX).toBe(1);
    expect(chunks[0]?.chunkY).toBe(1);
    expect(chunks[0]?.shadows).toEqual([{ tileX: 3, tileY: 2, mask: 3 }]);
  });

  it('masks shadow values down to the 4 defined quarter bits', () => {
    const shadows = new Array(16).fill(0);
    shadows[0] = 0x15; // junk above bit 3 must be ignored (-> 5)
    const map = makeMap({
      layers: {
        tileLayers: [
          new Array(16).fill(0),
          new Array(16).fill(0),
          new Array(16).fill(0),
          new Array(16).fill(0),
        ],
        shadows,
        regions: new Array(16).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);

    expect(chunks[0]?.shadows).toEqual([{ tileX: 0, tileY: 0, mask: 5 }]);
  });

  it('collects tiles from all 4 tile layers, tagging each with its layerIndex', () => {
    const width = 2;
    const height = 2;
    const size = width * height;
    const bottomLayer = new Array(size).fill(0);
    bottomLayer[0] = 1;
    const topLayer = new Array(size).fill(0);
    topLayer[0] = 1;
    const map = makeMap({
      width,
      height,
      layers: {
        tileLayers: [bottomLayer, new Array(size).fill(0), new Array(size).fill(0), topLayer],
        shadows: new Array(size).fill(0),
        regions: new Array(size).fill(0),
      },
    });

    const chunks = buildChunks(map, makeTileset(), SHEET_SIZES, 16);

    expect(chunks[0]?.tiles).toHaveLength(2);
    const layerIndices = chunks[0]?.tiles.map((tile) => tile.layerIndex).sort();
    expect(layerIndices).toEqual([0, 3]);
  });
});
