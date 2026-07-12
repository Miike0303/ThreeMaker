import { describe, expect, it } from 'vitest';
import {
  CURRENT_MAP_FORMAT_VERSION,
  MAP_FORMAT_MAGIC,
  MapFormatError,
  serializeMapDocument,
  type TileSemanticEntry,
  validateCurrentVersionShape,
} from '../src/schema.js';

function makeLayers(size: number): Record<string, unknown> {
  return {
    tiles: [
      new Array(size).fill(0),
      new Array(size).fill(0),
      new Array(size).fill(0),
      new Array(size).fill(0),
    ],
    shadows: new Array(size).fill(0),
    regions: new Array(size).fill(0),
  };
}

function makeValidDocInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const size = 2 * 2;
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'map-1',
    name: 'Test Map',
    width: 2,
    height: 2,
    tileset: {
      slots: { A1: { object: 'sha-a1' } },
      flags: [0],
      semantics: {},
    },
    floors: [{ id: 'floor-0', baseElevation: 0, layers: makeLayers(size) }],
    stairLinks: [],
    rooms: [],
    ...overrides,
  };
}

describe('validateCurrentVersionShape', () => {
  it('accepts a well-formed document at the current version', () => {
    const doc = validateCurrentVersionShape(makeValidDocInput());
    expect(doc.format).toBe(MAP_FORMAT_MAGIC);
    expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
    expect(doc.width).toBe(2);
    expect(doc.tileset.slots.A1).toEqual({ object: 'sha-a1' });
    expect(doc.floors).toHaveLength(1);
    expect(doc.floors[0]).toMatchObject({ id: 'floor-0', baseElevation: 0 });
    expect(doc.stairLinks).toEqual([]);
  });

  it('rejects a document with the wrong magic', () => {
    expect(() => validateCurrentVersionShape(makeValidDocInput({ format: 'not-a-map' }))).toThrow(
      MapFormatError,
    );
    try {
      validateCurrentVersionShape(makeValidDocInput({ format: 'not-a-map' }));
    } catch (err) {
      expect((err as MapFormatError).code).toBe('bad-magic');
    }
  });

  it('rejects a document at the wrong version for this function', () => {
    expect(() => validateCurrentVersionShape(makeValidDocInput({ version: 1 }))).toThrow(
      MapFormatError,
    );
  });

  it('rejects missing/malformed required fields', () => {
    expect(() => validateCurrentVersionShape(makeValidDocInput({ id: '' }))).toThrow(
      MapFormatError,
    );
    expect(() => validateCurrentVersionShape(makeValidDocInput({ width: 0 }))).toThrow(
      MapFormatError,
    );
    expect(() => validateCurrentVersionShape(makeValidDocInput({ width: 1.5 }))).toThrow(
      MapFormatError,
    );
    expect(() =>
      validateCurrentVersionShape(
        makeValidDocInput({ tileset: { slots: {}, flags: 'not-an-array', semantics: {} } }),
      ),
    ).toThrow(MapFormatError);
  });

  it('rejects a tile layer whose length does not match width * height', () => {
    const input = makeValidDocInput();
    (input.floors as Record<string, unknown>[])[0].layers = {
      ...makeLayers(4),
      tiles: [[0], [], [], []],
    };
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a missing "floors" field', () => {
    const input = makeValidDocInput();
    delete (input as Record<string, unknown>).floors;
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects an empty "floors" array', () => {
    expect(() => validateCurrentVersionShape(makeValidDocInput({ floors: [] }))).toThrow(
      MapFormatError,
    );
  });

  it('rejects a floor missing an id', () => {
    const input = makeValidDocInput({
      floors: [{ baseElevation: 0, layers: makeLayers(4) }],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a missing "stairLinks" field', () => {
    const input = makeValidDocInput();
    delete (input as Record<string, unknown>).stairLinks;
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a stair-link whose fromFloor/toFloor does not resolve to a known floor id', () => {
    const badFrom = makeValidDocInput({
      stairLinks: [
        {
          id: 'link-1',
          fromFloor: 'does-not-exist',
          toFloor: 'floor-0',
          bidirectional: false,
          waypoints: [
            { x: 0, y: 0, floor: 'floor-0' },
            { x: 1, y: 0, floor: 'floor-0' },
          ],
        },
      ],
    });
    expect(() => validateCurrentVersionShape(badFrom)).toThrow(MapFormatError);
  });

  it('rejects a stair-link with fewer than 2 waypoints', () => {
    const input = makeValidDocInput({
      stairLinks: [
        {
          id: 'link-1',
          fromFloor: 'floor-0',
          toFloor: 'floor-0',
          bidirectional: false,
          waypoints: [{ x: 0, y: 0, floor: 'floor-0' }],
        },
      ],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('accepts a well-formed stair-link referencing two known floors', () => {
    const input = makeValidDocInput({
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: makeLayers(4) },
        { id: 'floor-1', baseElevation: 3, layers: makeLayers(4) },
      ],
      stairLinks: [
        {
          id: 'link-1',
          fromFloor: 'floor-0',
          toFloor: 'floor-1',
          bidirectional: true,
          waypoints: [
            { x: 0, y: 0, floor: 'floor-0' },
            { x: 0, y: 0, floor: 'floor-1' },
          ],
        },
      ],
    });
    const doc = validateCurrentVersionShape(input);
    expect(doc.stairLinks).toHaveLength(1);
    expect(doc.stairLinks[0]).toMatchObject({ fromFloor: 'floor-0', toFloor: 'floor-1' });
  });

  it('rejects two floors sharing the same id (ambiguous stair-link floor refs)', () => {
    const input = makeValidDocInput({
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: makeLayers(4) },
        { id: 'floor-0', baseElevation: 3, layers: makeLayers(4) },
      ],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
    try {
      validateCurrentVersionShape(input);
    } catch (err) {
      expect((err as MapFormatError).code).toBe('malformed');
      expect((err as MapFormatError).message).toContain('floor-0');
      expect((err as MapFormatError).message).toContain('floors[0]');
      expect((err as MapFormatError).message).toContain('floors[1]');
    }
  });

  it('rejects a stair-link whose first waypoint floor does not match fromFloor', () => {
    const input = makeValidDocInput({
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: makeLayers(4) },
        { id: 'floor-1', baseElevation: 3, layers: makeLayers(4) },
      ],
      stairLinks: [
        {
          id: 'link-1',
          fromFloor: 'floor-0',
          toFloor: 'floor-1',
          bidirectional: false,
          waypoints: [
            { x: 0, y: 0, floor: 'floor-1' }, // WRONG: should be 'floor-0' (fromFloor)
            { x: 0, y: 0, floor: 'floor-1' },
          ],
        },
      ],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a stair-link whose last waypoint floor does not match toFloor', () => {
    const input = makeValidDocInput({
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: makeLayers(4) },
        { id: 'floor-1', baseElevation: 3, layers: makeLayers(4) },
      ],
      stairLinks: [
        {
          id: 'link-1',
          fromFloor: 'floor-0',
          toFloor: 'floor-1',
          bidirectional: false,
          waypoints: [
            { x: 0, y: 0, floor: 'floor-0' },
            { x: 0, y: 0, floor: 'floor-0' }, // WRONG: should be 'floor-1' (toFloor)
          ],
        },
      ],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a non-object input', () => {
    expect(() => validateCurrentVersionShape(null)).toThrow(MapFormatError);
    expect(() => validateCurrentVersionShape('nope')).toThrow(MapFormatError);
  });

  it('serializeMapDocument round-trips through JSON.parse + validateCurrentVersionShape', () => {
    const doc = validateCurrentVersionShape(makeValidDocInput());
    const json = serializeMapDocument(doc);
    const reparsed = validateCurrentVersionShape(JSON.parse(json));
    expect(reparsed).toEqual(doc);
  });

  it('accepts and round-trips a "ramp" semantic class with an explicit rampDirection override', () => {
    const input = makeValidDocInput({
      tileset: {
        slots: { A1: { object: 'sha-a1' } },
        flags: [0],
        semantics: {
          '5': { class: 'ramp', rampDirection: 'south' },
        },
      },
    });

    const doc = validateCurrentVersionShape(input);
    expect(doc.tileset.semantics['5']).toEqual({ class: 'ramp', rampDirection: 'south' });

    const json = serializeMapDocument(doc);
    const reparsed = validateCurrentVersionShape(JSON.parse(json));
    expect(reparsed).toEqual(doc);
  });

  it('TileSemanticEntry type accepts "ramp" class with an optional rampDirection', () => {
    const withOverride: TileSemanticEntry = { class: 'ramp', rampDirection: 'south' };
    const withoutOverride: TileSemanticEntry = { class: 'ramp' };
    expect(withOverride.rampDirection).toBe('south');
    expect(withoutOverride.rampDirection).toBeUndefined();
  });

  it('accepts a "ramp" semantic class with no rampDirection override (auto-derived at runtime)', () => {
    const doc = validateCurrentVersionShape(
      makeValidDocInput({
        tileset: {
          slots: {},
          flags: [0],
          semantics: { '5': { class: 'ramp' } },
        },
      }),
    );
    expect(doc.tileset.semantics['5']).toEqual({ class: 'ramp' });
  });
});

// techos-y-oclusion-interiores Slice 1: RoomDocument schema entity (additive,
// top-level `rooms[]` mirroring `stairLinks[]`, design ADR "Rooms placement").
describe('validateCurrentVersionShape: rooms (schema v3)', () => {
  it('accepts an empty "rooms" array (unauthored map, spec: Unauthored cell defaults)', () => {
    const doc = validateCurrentVersionShape(makeValidDocInput());
    expect(doc.rooms).toEqual([]);
  });

  it('rejects a missing "rooms" field', () => {
    const input = makeValidDocInput();
    delete (input as Record<string, unknown>).rooms;
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('accepts a well-formed room and round-trips it through serialize/parse', () => {
    const input = makeValidDocInput({
      rooms: [
        {
          id: 'room-1',
          name: 'Library',
          floor: 'floor-0',
          rects: [{ x: 0, y: 0, width: 2, height: 2 }],
        },
      ],
    });
    const doc = validateCurrentVersionShape(input);
    expect(doc.rooms).toHaveLength(1);
    expect(doc.rooms[0]).toEqual({
      id: 'room-1',
      name: 'Library',
      floor: 'floor-0',
      rects: [{ x: 0, y: 0, width: 2, height: 2 }],
    });

    const json = serializeMapDocument(doc);
    const reparsed = validateCurrentVersionShape(JSON.parse(json));
    expect(reparsed).toEqual(doc);
  });

  it('accepts a room with no "name" (optional field)', () => {
    const input = makeValidDocInput({
      rooms: [{ id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] }],
    });
    const doc = validateCurrentVersionShape(input);
    expect(doc.rooms[0]).toEqual({
      id: 'room-1',
      floor: 'floor-0',
      rects: [{ x: 0, y: 0, width: 1, height: 1 }],
    });
  });

  it('rejects two rooms sharing the same id on the same floor (spec: Unique room ids per floor)', () => {
    const input = makeValidDocInput({
      rooms: [
        { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
        { id: 'room-1', floor: 'floor-0', rects: [{ x: 1, y: 1, width: 1, height: 1 }] },
      ],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
    try {
      validateCurrentVersionShape(input);
    } catch (err) {
      expect((err as MapFormatError).code).toBe('malformed');
      expect((err as MapFormatError).message).toContain('room-1');
      expect((err as MapFormatError).message).toContain('rooms[0]');
      expect((err as MapFormatError).message).toContain('rooms[1]');
    }
  });

  it('accepts two rooms sharing the same id on DIFFERENT floors (uniqueness is per-floor, not global)', () => {
    const input = makeValidDocInput({
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: makeLayers(4) },
        { id: 'floor-1', baseElevation: 3, layers: makeLayers(4) },
      ],
      rooms: [
        { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
        { id: 'room-1', floor: 'floor-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
      ],
    });
    const doc = validateCurrentVersionShape(input);
    expect(doc.rooms).toHaveLength(2);
  });

  it('rejects a room whose "floor" does not reference an existing floor id', () => {
    const input = makeValidDocInput({
      rooms: [
        {
          id: 'room-1',
          floor: 'does-not-exist',
          rects: [{ x: 0, y: 0, width: 1, height: 1 }],
        },
      ],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a room with an empty "rects" array', () => {
    const input = makeValidDocInput({
      rooms: [{ id: 'room-1', floor: 'floor-0', rects: [] }],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a room rect that extends beyond the map bounds (spec: Cell references existing room)', () => {
    // A rect reaching outside the map would carve/light cells that can never
    // resolve back to this room at render time -- rejected at authoring time
    // rather than silently clamped.
    const input = makeValidDocInput({
      rooms: [{ id: 'room-1', floor: 'floor-0', rects: [{ x: 1, y: 1, width: 5, height: 5 }] }],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a room rect with a non-positive width or height', () => {
    const input = makeValidDocInput({
      rooms: [{ id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 0, height: 1 }] }],
    });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });
});

// loop-crear-jugar Slice 1: additive optional player-spawn field, no version
// bump (design: "v1/v2/v3 docs simply have spawn: undefined").
describe('validateCurrentVersionShape: spawn (additive, schema v3)', () => {
  it('accepts a document with no "spawn" field (omitted key, not undefined-valued)', () => {
    const doc = validateCurrentVersionShape(makeValidDocInput());
    expect(doc.spawn).toBeUndefined();
    expect(Object.hasOwn(doc, 'spawn')).toBe(false);
  });

  it('accepts a well-formed spawn and round-trips it through serialize/parse', () => {
    const input = makeValidDocInput({ spawn: { x: 1, y: 1, floor: 'floor-0' } });
    const doc = validateCurrentVersionShape(input);
    expect(doc.spawn).toEqual({ x: 1, y: 1, floor: 'floor-0' });

    const json = serializeMapDocument(doc);
    const reparsed = validateCurrentVersionShape(JSON.parse(json));
    expect(reparsed).toEqual(doc);
  });

  it('rejects a spawn whose "floor" does not reference an existing floor id', () => {
    const input = makeValidDocInput({ spawn: { x: 0, y: 0, floor: 'does-not-exist' } });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a spawn with non-integer coordinates', () => {
    const input = makeValidDocInput({ spawn: { x: 0.5, y: 0, floor: 'floor-0' } });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });

  it('rejects a spawn whose coordinates fall outside the map bounds', () => {
    const outOfBoundsX = makeValidDocInput({ spawn: { x: 2, y: 0, floor: 'floor-0' } });
    expect(() => validateCurrentVersionShape(outOfBoundsX)).toThrow(MapFormatError);
    const negativeY = makeValidDocInput({ spawn: { x: 0, y: -1, floor: 'floor-0' } });
    expect(() => validateCurrentVersionShape(negativeY)).toThrow(MapFormatError);
  });

  it('rejects a non-object spawn value', () => {
    const input = makeValidDocInput({ spawn: 'nope' });
    expect(() => validateCurrentVersionShape(input)).toThrow(MapFormatError);
  });
});
