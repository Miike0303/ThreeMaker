/**
 * Schema v2 acceptance tests (plantas-apiladas Slice 1, task 1.1): a v1
 * fixture must parse as a one-floor v2 document, a version newer than the
 * one this build understands must be rejected, and malformed `floors`/
 * `stairLinks` must be rejected. See `migrate.test.ts` for the full
 * migration-roundtrip compatibility gate and `schema.test.ts` for
 * `validateCurrentVersionShape`'s general structural-validation coverage.
 */
import { describe, expect, it } from 'vitest';
import { parseMapDocument } from '../src/migrate.js';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC, MapFormatError } from '../src/schema.js';

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

function makeV1Fixture(): Record<string, unknown> {
  const size = 2 * 2;
  return {
    format: MAP_FORMAT_MAGIC,
    version: 1,
    id: 'v1-fixture',
    name: 'V1 Fixture',
    width: 2,
    height: 2,
    tileset: { slots: {}, flags: [0], semantics: {} },
    layers: makeLayers(size),
  };
}

function makeV2Fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const size = 2 * 2;
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'v2-fixture',
    name: 'V2 Fixture',
    width: 2,
    height: 2,
    tileset: { slots: {}, flags: [0], semantics: {} },
    floors: [{ id: 'floor-0', baseElevation: 0, layers: makeLayers(size) }],
    stairLinks: [],
    ...overrides,
  };
}

describe('map-format v2 acceptance (Slice 1 compatibility gate)', () => {
  it('a v1 fixture parses as a one-floor v2 document', () => {
    const v1 = makeV1Fixture();
    const doc = parseMapDocument(v1);

    expect(doc.version).toBe(2);
    expect(doc.floors).toHaveLength(1);
    expect(doc.floors[0]?.id).toBe('floor-0');
    expect(doc.floors[0]?.baseElevation).toBe(0);
    expect(doc.floors[0]?.layers).toEqual((v1 as Record<string, unknown>).layers);
  });

  it('rejects a document version newer than CURRENT_MAP_FORMAT_VERSION', () => {
    const tooNew = makeV2Fixture({ version: CURRENT_MAP_FORMAT_VERSION + 1 });
    expect(() => parseMapDocument(tooNew)).toThrow(MapFormatError);
    try {
      parseMapDocument(tooNew);
    } catch (err) {
      expect((err as MapFormatError).code).toBe('unsupported-version');
    }
  });

  it('rejects a v2 document with a missing "floors" field', () => {
    const input = makeV2Fixture();
    delete (input as Record<string, unknown>).floors;
    expect(() => parseMapDocument(input)).toThrow(MapFormatError);
  });

  it('rejects a v2 document with an empty "floors" array', () => {
    expect(() => parseMapDocument(makeV2Fixture({ floors: [] }))).toThrow(MapFormatError);
  });

  it('rejects a v2 document whose stairLinks entry has fewer than 2 waypoints', () => {
    const input = makeV2Fixture({
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
    expect(() => parseMapDocument(input)).toThrow(MapFormatError);
  });

  it('rejects a v2 document whose stairLinks entry references a non-existent floor id', () => {
    const input = makeV2Fixture({
      stairLinks: [
        {
          id: 'link-1',
          fromFloor: 'floor-0',
          toFloor: 'missing-floor',
          bidirectional: false,
          waypoints: [
            { x: 0, y: 0, floor: 'floor-0' },
            { x: 0, y: 0, floor: 'missing-floor' },
          ],
        },
      ],
    });
    expect(() => parseMapDocument(input)).toThrow(MapFormatError);
  });

  it('rejects a v2 document with a missing "stairLinks" field', () => {
    const input = makeV2Fixture();
    delete (input as Record<string, unknown>).stairLinks;
    expect(() => parseMapDocument(input)).toThrow(MapFormatError);
  });

  it('accepts a native v2 document with no migration needed', () => {
    const doc = parseMapDocument(makeV2Fixture());
    expect(doc.floors).toHaveLength(1);
    expect(doc.stairLinks).toEqual([]);
  });
});
