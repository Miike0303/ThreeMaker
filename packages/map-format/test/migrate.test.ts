import { afterEach, describe, expect, it } from 'vitest';
import { clearMigrations, parseMapDocument, registerMigration } from '../src/migrate.js';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC, MapFormatError } from '../src/schema.js';

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
    layers: {
      tiles: [
        new Array(size).fill(0),
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

describe('parseMapDocument', () => {
  afterEach(() => {
    clearMigrations();
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
    expect(() => parseMapDocument(makeValidDocInput({ version: 0 }))).toThrow(MapFormatError);
  });

  it('applies a registered migration chain to reach the current version', () => {
    // Exercises the generic migration mechanism using a hypothetical
    // "version 0" shape that differs from the real v1 shape only by a
    // renamed field, proving the registry dispatches and loops correctly
    // (there are no real historical versions yet at version 1).
    registerMigration(0, (raw) => {
      const { legacyName, ...rest } = raw as Record<string, unknown> & { legacyName?: string };
      return { ...rest, version: 1, name: legacyName ?? '' };
    });

    const legacyInput = makeValidDocInput({ version: 0 });
    delete (legacyInput as Record<string, unknown>).name;
    (legacyInput as Record<string, unknown>).legacyName = 'Legacy';

    const doc = parseMapDocument(legacyInput);
    expect(doc.version).toBe(1);
    expect(doc.name).toBe('Legacy');
  });
});
