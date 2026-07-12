import type { RoomDocument } from '@threemaker/map-format';
import { primaryFloorLayers, validateCurrentVersionShape } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  composeDocumentFromPainterFloors,
  composeMapFromTilesets,
  createBlankMapDocument,
  mergeSlotFlags,
  painterFloorsFromDocument,
  seedDemoTiles,
  toRenderableMap,
  toRenderableTileset,
} from '../src/map-compose.js';
import { addRoom, createPainterState } from '../src/painter-store.js';

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
    expect(doc.floors).toHaveLength(1);
    expect(doc.floors[0]).toMatchObject({ id: 'floor-0', baseElevation: 0 });
    expect(doc.stairLinks).toEqual([]);
    const layers = primaryFloorLayers(doc);
    expect(layers.tiles).toHaveLength(4);
    for (const layer of layers.tiles) {
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

    expect(primaryFloorLayers(seeded).tiles[0]).toEqual([2816, 2816, 2816, 2816, 2816, 2816, 2816]);
    expect(primaryFloorLayers(seeded).tiles[2][0]).toBe(0);
    // Original doc is untouched (pure function).
    expect(primaryFloorLayers(doc).tiles[0][0]).toBe(0);
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
    expect(map.layers.tileLayers[0]).toBe(primaryFloorLayers(seeded).tiles[0]);
    expect(map.layers.shadows).toBe(primaryFloorLayers(seeded).shadows);

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

    const doc = composeMapFromTilesets({
      id: 'map-1',
      name: 'Two Games',
      width: 5,
      height: 5,
      sources: [
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
      ],
    });

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
    const doc = composeMapFromTilesets({
      id: 'map-1',
      name: 'Partial',
      width: 3,
      height: 3,
      sources: [{ slot: 'A2', tileset: { id: 1, gameId: 1, flags: null, sheets: [] } }],
    });
    expect(doc.tileset.slots.A2).toBeUndefined();
  });
});

describe('toRenderableMap: explicit floor index (Slice 4 -- active-floor-only viewport)', () => {
  it('renders floor 0 by default, unchanged from the pre-Slice-4 single-floor behavior', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 2,
      height: 2,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const seeded = seedDemoTiles(doc, 5, 0);
    const map = toRenderableMap(seeded);
    expect(map.layers.tileLayers[0]).toBe(seeded.floors[0]?.layers.tiles[0]);
  });

  it('renders the given floor index, not floor 0', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 2,
      height: 2,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const floor1Tiles = [1, 1, 1, 1];
    const groundFloor = doc.floors[0];
    if (!groundFloor) throw new Error('test setup: createBlankMapDocument always yields floors[0]');
    const twoFloorDoc = {
      ...doc,
      floors: [
        groundFloor,
        {
          id: 'floor-1',
          baseElevation: 3,
          layers: {
            tiles: [floor1Tiles, floor1Tiles, floor1Tiles, floor1Tiles],
            shadows: [0, 0, 0, 0],
            regions: [0, 0, 0, 0],
          },
        },
      ],
    };
    const map = toRenderableMap(twoFloorDoc, 1);
    expect(map.layers.tileLayers[0]).toBe(floor1Tiles);
  });

  it('throws for an out-of-range floor index', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 2,
      height: 2,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    expect(() => toRenderableMap(doc, 5)).toThrow();
  });
});

describe('painterFloorsFromDocument / composeDocumentFromPainterFloors (Slice 4 -- v2 multi-floor roundtrip)', () => {
  it('roundtrips a single-floor document unchanged (regression: v1-migrated maps)', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 2,
      height: 2,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const seeded = seedDemoTiles(doc, 9, 0);

    const painterFloors = painterFloorsFromDocument(seeded);
    expect(painterFloors).toHaveLength(1);
    expect(painterFloors[0]).toMatchObject({ id: 'floor-0', baseElevation: 0 });

    const composed = composeDocumentFromPainterFloors(seeded, painterFloors);
    expect(composed.floors).toHaveLength(1);
    expect(composed.floors[0]?.layers.tiles).toEqual(seeded.floors[0]?.layers.tiles);
    expect(composed.floors[0]?.layers.shadows).toBe(seeded.floors[0]?.layers.shadows);
    expect(composed.floors[0]?.layers.regions).toBe(seeded.floors[0]?.layers.regions);
    expect(composed.stairLinks).toEqual([]);
  });

  it('composes a real multi-floor document, preserving each floors baseElevation/label/shadows/regions and dropping stair-links referencing a removed floor', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 2,
      height: 2,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const groundFloor = doc.floors[0];
    if (!groundFloor) throw new Error('test setup: createBlankMapDocument always yields floors[0]');
    const withStairLink = {
      ...doc,
      floors: [
        groundFloor,
        {
          id: 'floor-1',
          label: 'Roof',
          baseElevation: 3,
          layers: {
            tiles: [
              [7, 7, 7, 7],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
            ] as const,
            shadows: [1, 1, 1, 1],
            regions: [2, 2, 2, 2],
          },
        },
      ],
      stairLinks: [
        {
          id: 'stair-1',
          fromFloor: 'floor-0',
          toFloor: 'floor-1',
          bidirectional: true,
          waypoints: [
            { x: 0, y: 0, floor: 'floor-0' },
            { x: 0, y: 0, floor: 'floor-1' },
          ],
        },
      ],
    };

    // The painter edited floor 0's tiles but floor 1 stays byte-identical.
    const painterFloors = painterFloorsFromDocument(withStairLink).map((floor) =>
      floor.id === 'floor-0'
        ? {
            ...floor,
            layers: [[9, 9, 9, 9], floor.layers[1], floor.layers[2], floor.layers[3]] as const,
          }
        : floor,
    );

    const composed = composeDocumentFromPainterFloors(withStairLink, painterFloors);
    expect(composed.floors).toHaveLength(2);
    expect(composed.floors[0]?.layers.tiles[0]).toEqual([9, 9, 9, 9]);
    expect(composed.floors[1]).toMatchObject({ id: 'floor-1', label: 'Roof', baseElevation: 3 });
    expect(composed.floors[1]?.layers.shadows).toEqual([1, 1, 1, 1]);
    expect(composed.floors[1]?.layers.regions).toEqual([2, 2, 2, 2]);
    // Both floors still exist -> the stair-link survives.
    expect(composed.stairLinks).toHaveLength(1);

    // Now simulate floor-1 being removed (painter-store's removeFloor already dropped it from `painterFloors`).
    const afterRemoval = composeDocumentFromPainterFloors(
      withStairLink,
      painterFloors.filter((floor) => floor.id !== 'floor-1'),
    );
    expect(afterRemoval.floors).toHaveLength(1);
    // The stair-link referenced the now-removed floor-1 -> dropped.
    expect(afterRemoval.stairLinks).toEqual([]);
  });

  it('gives a brand-new floor (no matching original) blank shadows/regions', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 2,
      height: 2,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const painterFloors = [
      ...painterFloorsFromDocument(doc),
      {
        id: 'floor-1',
        baseElevation: 3,
        layers: [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ] as const,
      },
    ];

    const composed = composeDocumentFromPainterFloors(doc, painterFloors);
    expect(composed.floors[1]?.layers.shadows).toEqual([0, 0, 0, 0]);
    expect(composed.floors[1]?.layers.regions).toEqual([0, 0, 0, 0]);
  });
});

describe('composeDocumentFromPainterFloors: rooms (Slice 5a -- map-format v3 native emit)', () => {
  it('defaults to the source document rooms when no rooms arg is given (regression: roomless map still composes rooms: [])', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 2,
      height: 2,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const painterFloors = painterFloorsFromDocument(doc);
    const composed = composeDocumentFromPainterFloors(doc, painterFloors);
    expect(composed.rooms).toEqual([]);
  });

  it('composes the explicitly-passed rooms into the document rooms field', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 4,
      height: 4,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const painterFloors = painterFloorsFromDocument(doc);
    const rooms: readonly RoomDocument[] = [
      { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 2, height: 2 }] },
    ];

    const composed = composeDocumentFromPainterFloors(doc, painterFloors, rooms);
    expect(composed.rooms).toEqual(rooms);
    // The composed document is a genuinely valid v3 shape.
    expect(() => validateCurrentVersionShape(composed)).not.toThrow();
  });

  it('drops rooms referencing a floor that no longer exists, mirroring stair-link cleanup', () => {
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 2,
      height: 2,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const groundFloor = doc.floors[0];
    if (!groundFloor) throw new Error('test setup: createBlankMapDocument always yields floors[0]');
    const twoFloorDoc = {
      ...doc,
      floors: [
        groundFloor,
        {
          id: 'floor-1',
          baseElevation: 3,
          layers: {
            tiles: [
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
            ] as const,
            shadows: [0, 0, 0, 0],
            regions: [0, 0, 0, 0],
          },
        },
      ],
    };
    const rooms: readonly RoomDocument[] = [
      { id: 'ground-room', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
      { id: 'roof-room', floor: 'floor-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
    ];
    const painterFloors = painterFloorsFromDocument(twoFloorDoc);

    // Floor 1 gets removed from the painter's floor list (mirrors removeFloor).
    const afterRemoval = composeDocumentFromPainterFloors(
      twoFloorDoc,
      painterFloors.filter((floor) => floor.id !== 'floor-1'),
      rooms,
    );
    expect(afterRemoval.rooms).toEqual([
      { id: 'ground-room', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
    ]);
  });
});

describe('painter-viewport room wiring recipe (Slice 5b -- closes the 5a-gate MUST-FIX gap)', () => {
  it('a room authored via the store round-trips through compose to the saved MapDocument.rooms', () => {
    // Load path: a document with an existing room must reach the painter
    // store's `state.rooms` (`createPainterState({ ..., rooms: doc.rooms })`
    // -- the first of `painter-viewport.ts`'s two MUST-FIX call sites).
    const doc = createBlankMapDocument({
      id: 'map-1',
      name: 'Demo',
      width: 4,
      height: 4,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const existingRoom: RoomDocument = {
      id: 'existing-room',
      floor: 'floor-0',
      rects: [{ x: 0, y: 0, width: 1, height: 1 }],
    };
    const docWithRoom = { ...doc, rooms: [existingRoom] };

    let state = createPainterState({
      floors: painterFloorsFromDocument(docWithRoom),
      width: docWithRoom.width,
      height: docWithRoom.height,
      rooms: docWithRoom.rooms,
    });
    expect(state.rooms).toEqual([existingRoom]); // loaded room reached the store

    // Author path: a NEW room added via the store must reach the saved
    // document (`composeDocumentFromPainterFloors(doc, floors, state.rooms)`
    // -- the second MUST-FIX call site, used at all 3 call sites in
    // `painter-viewport.ts`: `currentDocument`, `renderableSnapshot`,
    // `recomputeRampGlyphs`).
    state = addRoom(state, { id: 'new-room', rects: [{ x: 2, y: 2, width: 2, height: 2 }] });

    const saved = composeDocumentFromPainterFloors(docWithRoom, state.floors, state.rooms);
    expect(saved.rooms).toEqual([
      existingRoom,
      { id: 'new-room', floor: 'floor-0', rects: [{ x: 2, y: 2, width: 2, height: 2 }] },
    ]);

    // Regression guard for the bug this test closes: composing with the
    // OLD 2-arg call (defaulting to `docWithRoom.rooms`) would silently
    // drop the newly-authored room -- proving the 3rd-arg wiring is load-bearing.
    const withoutRoomsArg = composeDocumentFromPainterFloors(docWithRoom, state.floors);
    expect(withoutRoomsArg.rooms).toEqual([existingRoom]);
    expect(withoutRoomsArg.rooms).not.toEqual(saved.rooms);
  });
});
