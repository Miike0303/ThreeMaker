import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMigrations,
  migrateV1ToV2,
  migrateV2ToV3,
  parseMapDocument,
  registerMigration,
} from '../src/migrate.js';
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

function makeValidDocInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const size = 2 * 2;
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'map-1',
    name: 'Test Map',
    width: 2,
    height: 2,
    tileset: { slots: {}, flags: [0], semantics: {} },
    floors: [{ id: 'floor-0', baseElevation: 0, layers: makeLayers(size) }],
    stairLinks: [],
    rooms: [],
    ...overrides,
  };
}

/** A v2-shaped document: no `rooms` field at all -- what every real, pre-existing v2 `.tmmap.json` on disk looks like ahead of this migration. */
function makeV2DocInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const size = 2 * 2;
  return {
    format: MAP_FORMAT_MAGIC,
    version: 2,
    id: 'v2-map',
    name: 'V2 Map',
    width: 2,
    height: 2,
    tileset: { slots: {}, flags: [0], semantics: {} },
    floors: [{ id: 'floor-0', baseElevation: 0, layers: makeLayers(size) }],
    stairLinks: [],
    ...overrides,
  };
}

/** A v1-shaped document: single top-level `layers` group, no floors/stairLinks -- what every pre-existing `.tmmap.json` on disk looks like. */
function makeV1DocInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: MAP_FORMAT_MAGIC,
    version: 1,
    id: 'legacy-map',
    name: 'Legacy Map',
    width: 3,
    height: 2,
    tileset: {
      slots: { A1: { object: 'sha-a1' } },
      flags: [0],
      semantics: { '5': { class: 'wall' } },
    },
    layers: {
      tiles: [
        [1, 2, 3, 4, 5, 6],
        [0, 0, 0, 0, 0, 0],
        [7, 0, 0, 0, 0, 9],
        [0, 0, 0, 0, 0, 0],
      ],
      shadows: [0, 1, 0, 0, 1, 0],
      regions: [0, 0, 2, 0, 0, 0],
    },
    ...overrides,
  };
}

describe('parseMapDocument', () => {
  afterEach(() => {
    // `clearMigrations()` wipes EVERY registered migration, including the
    // real built-in ones registered at module load -- restore them so later
    // tests in this file (and any that assume the real migrations are
    // present) keep working. See `migrate.ts`'s `clearMigrations` doc comment.
    clearMigrations();
    registerMigration(1, migrateV1ToV2);
    registerMigration(2, migrateV2ToV3);
  });

  it('accepts a document already at the current version, with no migration needed', () => {
    const doc = parseMapDocument(makeValidDocInput());
    expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
  });

  it('rejects a document with the wrong format magic', () => {
    expect(() => parseMapDocument(makeValidDocInput({ format: 'something-else' }))).toThrow(
      MapFormatError,
    );
    try {
      parseMapDocument(makeValidDocInput({ format: 'something-else' }));
    } catch (err) {
      expect((err as MapFormatError).code).toBe('bad-magic');
    }
  });

  it('rejects a version newer than CURRENT_MAP_FORMAT_VERSION', () => {
    expect(() =>
      parseMapDocument(makeValidDocInput({ version: CURRENT_MAP_FORMAT_VERSION + 1 })),
    ).toThrow(MapFormatError);
    try {
      parseMapDocument(makeValidDocInput({ version: CURRENT_MAP_FORMAT_VERSION + 1 }));
    } catch (err) {
      expect((err as MapFormatError).code).toBe('unsupported-version');
    }
  });

  it('rejects an older version with no registered migration', () => {
    clearMigrations();
    expect(() => parseMapDocument(makeValidDocInput({ version: 0 }))).toThrow(MapFormatError);
  });

  it('applies a registered migration chain to reach the current version', () => {
    // Exercises the generic migration mechanism using a hypothetical
    // "version 0" shape that differs from the real v1 shape only by a
    // renamed field, proving the registry dispatches and loops correctly
    // across MULTIPLE hops (0 -> 1 via this ad-hoc migration, then 1 -> 2
    // via the real built-in `migrateV1ToV2`).
    registerMigration(0, (raw) => {
      const { legacyName, ...rest } = raw as Record<string, unknown> & { legacyName?: string };
      return { ...rest, version: 1, name: legacyName ?? '' };
    });

    const legacyInput = makeV1DocInput({ version: 0 });
    delete (legacyInput as Record<string, unknown>).name;
    (legacyInput as Record<string, unknown>).legacyName = 'Legacy';

    const doc = parseMapDocument(legacyInput);
    expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
    expect(doc.name).toBe('Legacy');
    expect(doc.floors).toHaveLength(1);
  });

  describe('v1 -> v2 -> v3 migration chain (compatibility gate)', () => {
    it('parses a v1 document all the way to the current version, byte-identical layers', () => {
      const v1Input = makeV1DocInput();
      const doc = parseMapDocument(v1Input);

      expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
      expect(doc.floors).toHaveLength(1);
      expect(doc.floors[0]?.id).toBe('floor-0');
      expect(doc.floors[0]?.baseElevation).toBe(0);
      // Byte-identical: floor-0's layers are EXACTLY the v1 doc's `layers`,
      // nothing dropped, nothing added, nothing reordered.
      expect(doc.floors[0]?.layers).toEqual((v1Input as { layers: unknown }).layers);
      expect(doc.stairLinks).toEqual([]);
      // v1 -> v2 -> v3: no rooms were ever authored along the way.
      expect(doc.rooms).toEqual([]);
      // Nothing else about the document changed.
      expect(doc.id).toBe('legacy-map');
      expect(doc.name).toBe('Legacy Map');
      expect(doc.tileset.semantics).toEqual({ '5': { class: 'wall' } });
    });

    it('roundtrips: v1 input -> migrate -> serialize -> parse -> floor-0 layers still byte-identical', () => {
      const v1Input = makeV1DocInput();
      const migrated = parseMapDocument(v1Input);

      const json = JSON.stringify(migrated);
      const reparsed = parseMapDocument(JSON.parse(json));

      expect(reparsed).toEqual(migrated);
      expect(reparsed.floors[0]?.layers).toEqual((v1Input as { layers: unknown }).layers);
    });

    it('a v1 doc parsed via migration behaves identically to an equivalent hand-authored v2 doc', () => {
      const v1Input = makeV1DocInput();
      const migratedDoc = parseMapDocument(v1Input);

      const equivalentV2Input = makeValidDocInput({
        id: 'legacy-map',
        name: 'Legacy Map',
        width: 3,
        height: 2,
        tileset: (v1Input as Record<string, unknown>).tileset,
        floors: [
          {
            id: 'floor-0',
            baseElevation: 0,
            layers: (v1Input as Record<string, unknown>).layers,
          },
        ],
        stairLinks: [],
      });
      const nativeDoc = parseMapDocument(equivalentV2Input);

      expect(migratedDoc).toEqual(nativeDoc);
    });

    it('a native document at the current version (no migration needed) validates as-is', () => {
      const doc = parseMapDocument(makeValidDocInput());
      expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
      expect(doc.floors[0]?.id).toBe('floor-0');
    });

    it('rejects malformed v2 input the same way validateCurrentVersionShape does: missing floors', () => {
      const input = makeValidDocInput();
      delete (input as Record<string, unknown>).floors;
      expect(() => parseMapDocument(input)).toThrow(MapFormatError);
    });

    it('rejects malformed v2 input: empty floors array', () => {
      expect(() => parseMapDocument(makeValidDocInput({ floors: [] }))).toThrow(MapFormatError);
    });

    it('rejects malformed v2 input: stair-link referencing an unknown floor id', () => {
      const input = makeValidDocInput({
        stairLinks: [
          {
            id: 'link-1',
            fromFloor: 'floor-0',
            toFloor: 'ghost-floor',
            bidirectional: false,
            waypoints: [
              { x: 0, y: 0, floor: 'floor-0' },
              { x: 0, y: 0, floor: 'ghost-floor' },
            ],
          },
        ],
      });
      expect(() => parseMapDocument(input)).toThrow(MapFormatError);
    });
  });

  // techos-y-oclusion-interiores Slice 1: v2 -> v3 lossless migration (THE
  // non-negotiable gate, locked decision obs #110 / design's Migration
  // section) -- mirrors this file's own v1 -> v2 describe block above.
  describe('v2 -> v3 migration (THE compatibility gate)', () => {
    it('migrates a roomless v2 document to v3 with an empty "rooms" array, otherwise unchanged', () => {
      const v2Input = makeV2DocInput();
      const doc = parseMapDocument(v2Input);

      expect(doc.version).toBe(3);
      expect(doc.rooms).toEqual([]);
      expect(doc.floors).toHaveLength(1);
      expect(doc.floors[0]?.layers).toEqual(
        (v2Input as { floors: { layers: unknown }[] }).floors[0]?.layers,
      );
      expect(doc.stairLinks).toEqual([]);
      expect(doc.id).toBe('v2-map');
      expect(doc.name).toBe('V2 Map');
    });

    it('full-document-equality roundtrip: reparse(migrate(v2)) deep-equals migrate(v2)', () => {
      const v2Input = makeV2DocInput();
      const migrated = parseMapDocument(v2Input);

      const json = JSON.stringify(migrated);
      const reparsed = parseMapDocument(JSON.parse(json));

      expect(reparsed).toEqual(migrated);
    });

    it('a migrated roomless v2 doc behaves identically to an equivalent hand-authored roomless v3 doc', () => {
      const v2Input = makeV2DocInput();
      const migratedDoc = parseMapDocument(v2Input);

      const equivalentV3Input = makeValidDocInput({
        id: 'v2-map',
        name: 'V2 Map',
        floors: (v2Input as Record<string, unknown>).floors,
        stairLinks: [],
        rooms: [],
      });
      const nativeDoc = parseMapDocument(equivalentV3Input);

      expect(migratedDoc).toEqual(nativeDoc);
    });

    it('migrateV2ToV3 directly: adds version 3 and an empty rooms array, drops nothing', () => {
      const v2Input = makeV2DocInput();
      const migrated = migrateV2ToV3(v2Input);

      expect(migrated).toEqual({ ...v2Input, version: 3, rooms: [] });
    });

    it('a native v3 document with rooms already authored (no migration needed) validates as-is', () => {
      const input = makeValidDocInput({
        rooms: [
          {
            id: 'room-1',
            floor: 'floor-0',
            rects: [{ x: 0, y: 0, width: 1, height: 1 }],
          },
        ],
      });
      const doc = parseMapDocument(input);
      expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
      expect(doc.rooms).toHaveLength(1);
    });
  });
});
