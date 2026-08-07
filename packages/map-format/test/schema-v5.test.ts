/**
 * Schema v5 acceptance (C5 WU-01): props collection + tileset.tilePixelSize,
 * plus the additive v4 -> v5 migration gate.
 *
 * Entry-level prop / tilePixelSize rejections live in `schema-v5-validation.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { migrateV4ToV5, parseMapDocument } from '../src/migrate.js';
import {
  CURRENT_MAP_FORMAT_VERSION,
  MAP_FORMAT_MAGIC,
  type MapDocument,
  type MapLayers,
  type PropDocument,
  serializeMapDocument,
} from '../src/schema.js';

const LAYER = [0, 0, 0, 0];
const LAYERS: MapLayers = { tiles: [LAYER, LAYER, LAYER, LAYER], shadows: LAYER, regions: LAYER };
const OBJECT_A = 'a'.repeat(64);
const OBJECT_B = 'b'.repeat(64);
const V5_KEYS = ['props'] as const;

const PROP: PropDocument = {
  id: 'lamp',
  x: 0,
  y: 0,
  floor: 'floor-0',
  object: OBJECT_A,
};

const BASE: MapDocument = {
  format: MAP_FORMAT_MAGIC,
  version: CURRENT_MAP_FORMAT_VERSION,
  id: 'v5-fixture',
  name: 'V5 Fixture',
  width: 2,
  height: 2,
  tileset: { slots: {}, flags: [0], semantics: {}, tilePixelSize: 48 },
  floors: [
    { id: 'floor-0', baseElevation: 0, layers: LAYERS },
    { id: 'floor-1', baseElevation: 3, layers: LAYERS },
  ],
  stairLinks: [],
  rooms: [],
  spawn: { x: 0, y: 0, floor: 'floor-0' },
  npcs: [],
  triggers: [],
  events: {},
  worldSeeds: {},
  props: [],
};

/** A valid v4-shaped raw document (no props, no tilePixelSize). */
function makeV4Raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { props: _p, ...rest } = BASE as MapDocument & { props?: unknown };
  const tileset = { slots: {}, flags: [0], semantics: {} };
  return {
    ...rest,
    version: 4,
    tileset,
    npcs: [],
    triggers: [],
    events: {},
    worldSeeds: {},
    ...overrides,
  };
}

describe('map-format v5 props + tilePixelSize preservation', () => {
  it('parses a v5 document with valid props, including two props sharing a tile', () => {
    const lamp: PropDocument = { ...PROP, id: 'lamp', x: 1, y: 1 };
    const vase: PropDocument = {
      id: 'vase',
      x: 1,
      y: 1,
      floor: 'floor-0',
      object: OBJECT_B,
      scale: 1.5,
      rotationY: 90,
      animation: 'idle',
    };
    const input: MapDocument = {
      ...BASE,
      tileset: { ...BASE.tileset, tilePixelSize: 96 },
      props: [lamp, vase],
    };

    const doc = parseMapDocument(JSON.parse(serializeMapDocument(input)));
    expect(doc.version).toBe(5);
    expect(doc.props).toEqual([lamp, vase]);
    expect(doc.tileset.tilePixelSize).toBe(96);
  });

  it('round-trips parse(serialize(doc)) for props + non-default tilePixelSize', () => {
    const input: MapDocument = {
      ...BASE,
      tileset: { ...BASE.tileset, tilePixelSize: 96 },
      props: [
        { ...PROP, id: 'table', x: 1, y: 0, scale: 2, rotationY: -45, animation: 'spin' },
        { ...PROP, id: 'cup', x: 1, y: 0, object: OBJECT_B },
      ],
    };

    expect(parseMapDocument(JSON.parse(serializeMapDocument(input)))).toEqual(input);
  });

  it('accepts tilePixelSize 48 and 96', () => {
    expect(
      parseMapDocument({ ...BASE, tileset: { ...BASE.tileset, tilePixelSize: 48 } }).tileset
        .tilePixelSize,
    ).toBe(48);
    expect(
      parseMapDocument({ ...BASE, tileset: { ...BASE.tileset, tilePixelSize: 96 } }).tileset
        .tilePixelSize,
    ).toBe(96);
  });
});

describe('map-format v4 -> v5 migration (additive, lossless)', () => {
  it('adds props: [] and stamps tileset.tilePixelSize = 48', () => {
    const v4 = makeV4Raw();
    const doc = parseMapDocument(v4);

    expect(doc.version).toBe(5);
    expect(doc.props).toEqual([]);
    expect(doc.tileset.tilePixelSize).toBe(48);
    expect(Object.keys(doc)).toEqual(expect.arrayContaining([...V5_KEYS]));
  });

  it('migrateV4ToV5 directly: version 5, empty props, tilePixelSize 48, drops nothing else', () => {
    const v4 = makeV4Raw({ id: 'hand-v4' });
    const migrated = migrateV4ToV5(v4);

    expect(migrated.version).toBe(5);
    expect(migrated.props).toEqual([]);
    expect((migrated.tileset as { tilePixelSize: number }).tilePixelSize).toBe(48);
    expect(migrated.id).toBe('hand-v4');
  });

  it('rejects a version-4 document that already carries props instead of discarding it', () => {
    const v4 = makeV4Raw({ props: [PROP] });

    expect(() => parseMapDocument(v4)).toThrow(
      'Map document declares "version": 4 but already carries v5 content ("props"). Set "version" to 5 -- the v4 -> v5 migration would otherwise discard it.',
    );
  });

  it('rejects a version-4 document that already carries tileset.tilePixelSize', () => {
    const v4 = makeV4Raw({
      tileset: { slots: {}, flags: [0], semantics: {}, tilePixelSize: 96 },
    });

    expect(() => parseMapDocument(v4)).toThrow(
      'Map document declares "version": 4 but already carries v5 content ("tilePixelSize"). Set "version" to 5 -- the v4 -> v5 migration would otherwise discard it.',
    );
  });

  it('names every v5 key found on a slipped version-4 document', () => {
    const v4 = makeV4Raw({
      props: [],
      tileset: { slots: {}, flags: [0], semantics: {}, tilePixelSize: 48 },
    });

    expect(() => parseMapDocument(v4)).toThrow('("props", "tilePixelSize")');
  });

  it('walks the full chain from the earliest supported version (v1) to v5', () => {
    const v1 = {
      format: MAP_FORMAT_MAGIC,
      version: 1,
      id: 'legacy-v1',
      name: 'Legacy',
      width: 2,
      height: 2,
      tileset: { slots: {}, flags: [0], semantics: {} },
      layers: {
        tiles: [LAYER, LAYER, LAYER, LAYER],
        shadows: LAYER,
        regions: LAYER,
      },
    };

    const doc = parseMapDocument(v1);
    expect(doc.version).toBe(5);
    expect(doc.props).toEqual([]);
    expect(doc.tileset.tilePixelSize).toBe(48);
    expect(doc.npcs).toEqual([]);
    expect(doc.rooms).toEqual([]);
  });
});
