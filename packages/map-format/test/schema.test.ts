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
