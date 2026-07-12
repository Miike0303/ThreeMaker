/**
 * `translateMapDocument` (loop-crear-jugar design, "Translator home"):
 * DEV-demo-equivalent `MapDocument` -> `{floorSources, stairLinks, spawn}`
 * parity oracle (spec: "DEV-demo-equivalent document translates
 * identically"). The oracle values below are lifted directly from
 * `apps/desktop/src/main.ts`: `DEV_DEMO_FLOOR_SIZE` (32), `DEV_DEMO_FLOOR_HEIGHT`
 * (3), `buildDevDemoRooms`/`DEV_DEMO_ROOM_ID` ('demo-library', rect
 * {x:2,y:2,width:10,height:10} on floor 0), `buildDevDemoStairLinks`
 * (`DEV_DEMO_STAIR_ROW` 16, entry x 17, landing x 18), and the ramp-cell
 * positions/override from `DEMO_RAMP_SEMANTICS` (also the oracle already
 * proven in `packages/map-format/test/runtime-bridge.test.ts`'s parity test
 * -- reused here verbatim to prove the translator wires `deriveRampCells`
 * through unchanged, not to re-derive ramp semantics from scratch).
 */
import type { MapDocument, SemanticOverrides } from '@threemaker/map-format';
import { MAP_FORMAT_MAGIC } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { translateMapDocument } from '../src/map-document-runtime.js';

const FLOOR_SIZE = 32;
const FLOOR_HEIGHT = 3;

/** Row-major all-zero tile layer, `width * height` entries. */
function emptyLayer(width: number, height: number): number[] {
  return new Array(width * height).fill(0);
}

/** Mirrors `runtime-bridge.test.ts`'s parity-oracle layer: tile id 20 = plain ramp, 21 = ramp with a `north` override, painted at `DEMO_RAMP_SEMANTICS`'s 7 positions on an otherwise-blank ground layer. */
function rampGroundLayer(width: number, height: number): number[] {
  const layer = emptyLayer(width, height);
  const positions: readonly [number, number][] = [
    [9, 7],
    [11, 2],
    [11, 3],
    [11, 4],
    [11, 5],
    [11, 6],
    [11, 7],
  ];
  for (const [x, y] of positions) {
    layer[y * width + x] = x === 11 && y === 4 ? 21 : 20;
  }
  return layer;
}

const RAMP_SEMANTICS: SemanticOverrides = {
  '20': { class: 'ramp' },
  '21': { class: 'ramp', rampDirection: 'north' },
};

const EXPECTED_RAMP_CELLS = [
  { x: 11, y: 2 },
  { x: 11, y: 3 },
  { x: 11, y: 4, rampDirection: 'north' },
  { x: 11, y: 5 },
  { x: 11, y: 6 },
  { x: 9, y: 7 },
  { x: 11, y: 7 },
];

const STAIR_ROW = Math.floor(FLOOR_SIZE / 2); // 16
const STAIR_ENTRY_X = STAIR_ROW + 1; // 17
const STAIR_LANDING_X = STAIR_ROW + 2; // 18

/** Builds a DEV-demo-equivalent 2-floor `MapDocument`: floor-0 carries the ramp-classed ground layer + a "demo-library" room + the authored spawn, floor-1 is a blank upper floor; one bidirectional stair-link connects them, mirroring `buildDevDemoStairLinks`'s 2-waypoint shape exactly. */
function buildDevDemoEquivalentDocument(): MapDocument {
  return {
    format: MAP_FORMAT_MAGIC,
    version: 3,
    id: 'dev-demo',
    name: 'Dev Demo',
    width: FLOOR_SIZE,
    height: FLOOR_SIZE,
    tileset: { slots: {}, flags: [], semantics: RAMP_SEMANTICS },
    floors: [
      {
        id: 'floor-0',
        baseElevation: 0,
        layers: {
          tiles: [
            rampGroundLayer(FLOOR_SIZE, FLOOR_SIZE),
            emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
            emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
            emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
          ],
          shadows: emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
          regions: emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
        },
      },
      {
        id: 'floor-1',
        baseElevation: FLOOR_HEIGHT,
        layers: {
          tiles: [
            emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
            emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
            emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
            emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
          ],
          shadows: emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
          regions: emptyLayer(FLOOR_SIZE, FLOOR_SIZE),
        },
      },
    ],
    stairLinks: [
      {
        id: 'demo-stair-0-1',
        fromFloor: 'floor-0',
        toFloor: 'floor-1',
        bidirectional: true,
        waypoints: [
          { x: STAIR_ENTRY_X, y: STAIR_ROW, floor: 'floor-0' },
          { x: STAIR_LANDING_X, y: STAIR_ROW, floor: 'floor-1' },
        ],
      },
    ],
    rooms: [
      {
        id: 'demo-library',
        name: 'Demo Library',
        floor: 'floor-0',
        rects: [{ x: 2, y: 2, width: 10, height: 10 }],
      },
    ],
    spawn: { x: 5, y: 5, floor: 'floor-0' },
  };
}

describe('translateMapDocument', () => {
  it('produces one TranslatedFloorSource per floor, in floors array order', () => {
    const result = translateMapDocument(buildDevDemoEquivalentDocument());

    expect(result.floorSources).toHaveLength(2);
    expect(result.floorSources[0]?.floorId).toBe('floor-0');
    expect(result.floorSources[0]?.baseElevation).toBe(0);
    expect(result.floorSources[1]?.floorId).toBe('floor-1');
    expect(result.floorSources[1]?.baseElevation).toBe(FLOOR_HEIGHT);
  });

  it("bridges each floor into an RpgmMap matching that floor's own layers/dimensions", () => {
    const doc = buildDevDemoEquivalentDocument();
    const result = translateMapDocument(doc);

    const floor0Map = result.floorSources[0]?.map;
    expect(floor0Map?.width).toBe(FLOOR_SIZE);
    expect(floor0Map?.height).toBe(FLOOR_SIZE);
    expect(floor0Map?.layers.tileLayers).toEqual(doc.floors[0]?.layers.tiles);
    expect(floor0Map?.layers.shadows).toEqual(doc.floors[0]?.layers.shadows);
    expect(floor0Map?.layers.regions).toEqual(doc.floors[0]?.layers.regions);
  });

  it('bridges the document tileset into an RpgmTileset carrying the same flags', () => {
    const doc = buildDevDemoEquivalentDocument();
    const result = translateMapDocument(doc);

    expect(result.floorSources[0]?.tileset.flags).toBe(doc.tileset.flags);
    // Same tileset reference/shape on every floor -- a document has exactly one tileset.
    expect(result.floorSources[1]?.tileset.flags).toBe(doc.tileset.flags);
  });

  it('derives ramp cells identical to the DEMO_RAMP_SEMANTICS oracle, including the (11,4) north override', () => {
    const result = translateMapDocument(buildDevDemoEquivalentDocument());
    expect(result.floorSources[0]?.rampCells).toEqual(EXPECTED_RAMP_CELLS);
  });

  it('a floor with no ramp-classed tiles gets an empty rampCells array', () => {
    const result = translateMapDocument(buildDevDemoEquivalentDocument());
    expect(result.floorSources[1]?.rampCells).toEqual([]);
  });

  it("computes roomIdGrid only for a floor with authored rooms, matching computeRoomIdGrid's own output", () => {
    const doc = buildDevDemoEquivalentDocument();
    const result = translateMapDocument(doc);

    const grid = result.floorSources[0]?.roomIdGrid;
    expect(grid).toBeInstanceOf(Uint16Array);
    // The library rect is x:[2,12) y:[2,12) -- inside it is room ordinal 1, outside is 0.
    expect(grid?.[5 * FLOOR_SIZE + 5]).toBe(1);
    expect(grid?.[0 * FLOOR_SIZE + 0]).toBe(0);

    expect(result.floorSources[1]?.roomIdGrid).toBeUndefined();
  });

  it('resolves stair-link string floor ids to floors-array indices, in floors array order', () => {
    const result = translateMapDocument(buildDevDemoEquivalentDocument());

    expect(result.stairLinks).toEqual([
      {
        id: 'demo-stair-0-1',
        fromFloor: 0,
        toFloor: 1,
        bidirectional: true,
        waypoints: [
          { x: STAIR_ENTRY_X, y: STAIR_ROW, floor: 0 },
          { x: STAIR_LANDING_X, y: STAIR_ROW, floor: 1 },
        ],
      },
    ]);
  });

  it('resolves string floor ids by ARRAY ORDER, not by parsing a numeric suffix out of the id', () => {
    const doc = buildDevDemoEquivalentDocument();
    const [groundFloor, upperFloor] = doc.floors;
    if (!groundFloor || !upperFloor) throw new Error('fixture must have exactly 2 floors');
    // Reorder + rename floors so the id string gives no numeric hint at all --
    // proves resolution walks `doc.floors` looking for a matching `.id`,
    // rather than deriving the index from the id text itself.
    const reordered: MapDocument = {
      ...doc,
      floors: [
        { ...upperFloor, id: 'upper' },
        { ...groundFloor, id: 'ground' },
      ],
      stairLinks: [
        {
          id: 'link',
          fromFloor: 'ground',
          toFloor: 'upper',
          bidirectional: false,
          waypoints: [
            { x: 1, y: 1, floor: 'ground' },
            { x: 2, y: 2, floor: 'upper' },
          ],
        },
      ],
      rooms: [],
      spawn: undefined,
    };

    const result = translateMapDocument(reordered);
    expect(result.stairLinks).toEqual([
      {
        id: 'link',
        fromFloor: 1,
        toFloor: 0,
        bidirectional: false,
        waypoints: [
          { x: 1, y: 1, floor: 1 },
          { x: 2, y: 2, floor: 0 },
        ],
      },
    ]);
  });

  it('resolves an authored spawn to its floor index', () => {
    const result = translateMapDocument(buildDevDemoEquivalentDocument());
    expect(result.spawn).toEqual({ x: 5, y: 5, floorIndex: 0 });
  });

  it("resolves spawn to undefined when the document authors none (findSpawnTile fallback is the caller's job)", () => {
    const doc = buildDevDemoEquivalentDocument();
    const { spawn: _omit, ...withoutSpawn } = doc;
    const result = translateMapDocument(withoutSpawn as MapDocument);
    expect(result.spawn).toBeUndefined();
  });
});
