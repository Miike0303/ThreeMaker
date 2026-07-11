import { describe, expect, it } from 'vitest';
import {
  composeMapFromTilesets,
  createBlankMapDocument,
  mergeSlotFlags,
  seedDemoTiles,
  toRenderableMap,
  toRenderableTileset,
} from '../src/map-compose.js';

describe('mergeSlotFlags', () => {
  it('copies only the given slot own id range from its source flags, leaving everything else 0', () => {
    const sourceA = new Array(8192).fill(0);
    sourceA[2816] = 0x10; // first A2 id, star bit
    const sourceB = new Array(8192).fill(0);
    sourceB[0] = 0x20; // first B id, some other bit

    const merged = mergeSlotFlags([
      { slot: 'A2', sourceFlags: sourceA },
      { slot: 'B', sourceFlags: sourceB },
    ]);

    expect(merged[2816]).toBe(0x10);
    expect(merged[0]).toBe(0x20);
    // Outside either composed slot's range: untouched (0), even though sourceA/B have data there conceptually.
    expect(merged[256]).toBe(0); // C-range, not composed
  });

  it('returns an all-zero array of the correct length when no sources are given', () => {
    const merged = mergeSlotFlags([]);
    expect(merged).toHaveLength(8192);
    expect(merged.every((flag) => flag === 0)).toBe(true);
  });

  it('does not let one slot leak into another slots id range', () => {
    const sourceA2 = new Array(8192).fill(0);
    sourceA2[4351] = 0x99; // last A2 id
    const merged = mergeSlotFlags([{ slot: 'A2', sourceFlags: sourceA2 }]);
    expect(merged[4351]).toBe(0x99);
    expect(merged[4352]).toBe(0); // first A3 id: a different slot's range
  });
});

describe('createBlankMapDocument', () => {
  it('produces a valid, all-empty map with the given slot composition', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 3,
      height: 2,
      slots: { A2: { object: 'sha-a', sourceTilesetId: 1, sourceGameId: 1 } },
      flags: new Array(8192).fill(0),
    });

    expect(doc.width).toBe(3);
    expect(doc.height).toBe(2);
    expect(doc.tileset.slots.A2).toEqual({ object: 'sha-a', sourceTilesetId: 1, sourceGameId: 1 });
    expect(doc.layers.tiles).toHaveLength(4);
    for (const layer of doc.layers.tiles) {
      expect(layer).toEqual([0, 0, 0, 0, 0, 0]);
    }
  });
});

describe('seedDemoTiles', () => {
  it('fills layer 0 entirely with groundTileId and scatters decorTileId sparsely on layer 2', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 7,
      height: 1,
      slots: {},
      flags: new Array(8192).fill(0),
    });

    const seeded = seedDemoTiles(doc, 2816, 0);

    expect(seeded.layers.tiles[0]).toEqual([2816, 2816, 2816, 2816, 2816, 2816, 2816]);
    expect(seeded.layers.tiles[2][0]).toBe(0);
    // Original doc is untouched (pure function).
    expect(doc.layers.tiles[0][0]).toBe(0);
  });
});

describe('toRenderableMap / toRenderableTileset', () => {
  it('bridges a MapDocument to the RpgmMap/RpgmTileset shapes buildChunks expects', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo Map',
      width: 4,
      height: 4,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const seeded = seedDemoTiles(doc, 2816, 69);

    const map = toRenderableMap(seeded);
    expect(map.width).toBe(4);
    expect(map.height).toBe(4);
    expect(map.layers.tileLayers[0]).toBe(seeded.layers.tiles[0]);
    expect(map.layers.shadows).toBe(seeded.layers.shadows);

    const tileset = toRenderableTileset(seeded);
    expect(tileset.flags).toBe(seeded.tileset.flags);
  });
});

describe('composeMapFromTilesets', () => {
  it('composes one slot per source tileset, from two different games', () => {
    const flagsA = new Array(8192).fill(0);
    flagsA[2816] = 0x10;
    const flagsB = new Array(8192).fill(0);
    flagsB[1] = 0x20;

    const doc = composeMapFromTilesets('map-1', 'Two Games', 5, 5, [
      {
        slot: 'A2',
        tileset: {
          id: 10,
          gameId: 1,
          flags: JSON.stringify(flagsA),
          sheets: [{ slot: 'A2', sha256: 'sha-a2' }],
        },
      },
      {
        slot: 'B',
        tileset: {
          id: 20,
          gameId: 2,
          flags: JSON.stringify(flagsB),
          sheets: [{ slot: 'B', sha256: 'sha-b' }],
        },
      },
    ]);

    expect(doc.tileset.slots.A2).toEqual({
      object: 'sha-a2',
      sourceTilesetId: 10,
      sourceGameId: 1,
    });
    expect(doc.tileset.slots.B).toEqual({ object: 'sha-b', sourceTilesetId: 20, sourceGameId: 2 });
    expect(doc.tileset.flags[2816]).toBe(0x10);
    expect(doc.tileset.flags[1]).toBe(0x20);
  });

  it('skips a slot whose tileset has no sheet for it, instead of throwing', () => {
    const doc = composeMapFromTilesets('map-1', 'Partial', 3, 3, [
      { slot: 'A2', tileset: { id: 1, gameId: 1, flags: null, sheets: [] } },
    ]);
    expect(doc.tileset.slots.A2).toBeUndefined();
  });
});
