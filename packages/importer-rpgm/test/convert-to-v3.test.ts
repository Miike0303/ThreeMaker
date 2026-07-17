import { MAP_FORMAT_MAGIC, validateCurrentVersionShape } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { convertRpgmMap } from '../src/convert-to-v3.js';
import type { RpgmMap, RpgmTileset, TileSheetNames } from '../src/types.js';

const EMPTY_SHEET_NAMES: TileSheetNames = {
  A1: '',
  A2: '',
  A3: '',
  A4: '',
  A5: '',
  B: '',
  C: '',
  D: '',
  E: '',
};

/** 3x2 map: tile id 1 on layer 0 everywhere except (0,0), which stays empty (id 0). */
function buildSyntheticMap(overrides: Partial<RpgmMap> = {}): RpgmMap {
  const width = 3;
  const height = 2;
  const size = width * height;
  const ground = new Array(size).fill(1);
  ground[0] = 0; // (0,0) left empty on purpose
  return {
    id: 100,
    displayName: 'Synthetic Map',
    width,
    height,
    tilesetId: 1,
    scrollType: 0,
    layers: {
      tileLayers: [
        ground,
        new Array(size).fill(0),
        new Array(size).fill(0),
        new Array(size).fill(0),
      ],
      shadows: new Array(size).fill(0),
      regions: new Array(size).fill(0),
    },
    ...overrides,
  };
}

function buildSyntheticTileset(overrides: Partial<RpgmTileset> = {}): RpgmTileset {
  const flags = new Array(8192).fill(0);
  // Tile id 1: fully impassable in every direction (wall).
  flags[1] = 0xf;
  return {
    id: 1,
    name: 'Synthetic Tileset',
    sheetNames: EMPTY_SHEET_NAMES,
    flags,
    ...overrides,
  };
}

describe('convertRpgmMap', () => {
  it('maps tile/shadow/region layers 1:1 into a single floor at baseElevation 0', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(doc.format).toBe(MAP_FORMAT_MAGIC);
    expect(doc.version).toBe(3);
    expect(doc.width).toBe(3);
    expect(doc.height).toBe(2);
    expect(doc.floors).toHaveLength(1);
    expect(doc.floors[0]?.baseElevation).toBe(0);
    expect(doc.floors[0]?.layers.tiles).toEqual(map.layers.tileLayers);
    expect(doc.floors[0]?.layers.shadows).toEqual(map.layers.shadows);
    expect(doc.floors[0]?.layers.regions).toEqual(map.layers.regions);
    expect(doc.stairLinks).toEqual([]);
    expect(doc.rooms).toEqual([]);
  });

  it('carries the RPGM tileset flags through unchanged', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(doc.tileset.flags).toEqual(tileset.flags);
    expect(doc.tileset.slots).toEqual({});
    expect(doc.tileset.semantics).toEqual({});
  });

  it('derives an id from the RPGM numeric map id when none is given', () => {
    const map = buildSyntheticMap({ id: 42 });
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(doc.id).toBe('rpgm-map-42');
  });

  it('honors an explicit id override', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset, { id: 'custom-id' });

    expect(doc.id).toBe('custom-id');
  });

  it('uses the given player start as spawn when this map is the RPGM start map', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset, { playerStart: { x: 2, y: 1 } });

    expect(doc.spawn).toEqual({ x: 2, y: 1, floor: 'floor-0' });
  });

  it('omits spawn entirely when no player start is given, even on a map with standable tiles (spawn-quality bug fix: let the desktop runtime pick)', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    // (0,0) is standable here (every other cell has the wall tile, id 1),
    // but this converter no longer synthesizes a spawn for a non-start map
    // at all -- `apps/desktop/src/spawn.ts`'s `resolveInitialSpawn` ->
    // `findSpawnTile` center-out search (which also applies the
    // strengthened "has a usable exit" predicate) picks a better position
    // at load time instead of trusting a row-major first-standable-tile
    // scan that has no way to know if that tile is enclosed/reachable.
    const doc = convertRpgmMap(map, tileset);

    expect(doc.spawn).toBeUndefined();
  });

  it('produces a document that passes full schema validation', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(() => validateCurrentVersionShape(doc)).not.toThrow();
  });

  it('passes given tileset slots through verbatim (catalog lookup is the caller job, not this pure converters)', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();
    const slots = {
      A1: { object: 'abc123', sourceTilesetId: 7, sourceGameId: 1 },
    };

    const doc = convertRpgmMap(map, tileset, { slots });

    expect(doc.tileset.slots).toEqual(slots);
  });

  it('defaults slots to an empty object when none are given (unchanged spike behavior)', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(doc.tileset.slots).toEqual({});
  });
});
