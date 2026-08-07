/**
 * Schema v5 ENTRY-level validation (C5 WU-01): props field rejections and
 * tileset.tilePixelSize bounds.
 */
import { describe, expect, it } from 'vitest';
import { parseMapDocument } from '../src/migrate.js';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC, type MapLayers } from '../src/schema.js';

const LAYER: readonly number[] = new Array(4 * 4).fill(0);
const LAYERS: MapLayers = { tiles: [LAYER, LAYER, LAYER, LAYER], shadows: LAYER, regions: LAYER };
const OBJECT_A = 'a'.repeat(64);
const OBJECT_B = 'b'.repeat(64);

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'v5-validation',
    name: 'V5 Validation',
    width: 4,
    height: 4,
    tileset: { slots: {}, flags: [0], semantics: {}, tilePixelSize: 48 },
    floors: [
      { id: 'floor-0', baseElevation: 0, layers: LAYERS },
      { id: 'floor-1', baseElevation: 3, layers: LAYERS },
    ],
    stairLinks: [],
    rooms: [],
    npcs: [],
    triggers: [],
    events: {},
    worldSeeds: {},
    props: [],
    ...overrides,
  };
}

/** Fully valid raw prop entry; each case invalidates exactly one field. */
function prop(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lamp',
    x: 1,
    y: 1,
    floor: 'floor-0',
    object: OBJECT_A,
    ...overrides,
  };
}

describe('map-format v5 props validation', () => {
  it('rejects a prop with an empty id', () => {
    expect(() => parseMapDocument(raw({ props: [prop({ id: '' })] }))).toThrow(
      '"props[0].id" must be a non-empty string.',
    );
  });

  it('rejects two props with the same id, naming both entries', () => {
    expect(() =>
      parseMapDocument(
        raw({
          props: [prop({ id: 'lamp', x: 0, y: 0 }), prop({ id: 'lamp', x: 1, y: 1 })],
        }),
      ),
    ).toThrow('"props[1]" ("lamp") reuses the same id as "props[0]".');
  });

  it('rejects a non-integer or out-of-bounds tile coordinate', () => {
    expect(() => parseMapDocument(raw({ props: [prop({ x: 1.5 })] }))).toThrow(
      '"props[0].x" of "lamp" must be an integer within [0, 4), got 1.5.',
    );
    expect(() => parseMapDocument(raw({ props: [prop({ y: 4 })] }))).toThrow(
      '"props[0].y" of "lamp" must be an integer within [0, 4), got 4.',
    );
    expect(() => parseMapDocument(raw({ props: [prop({ x: -1 })] }))).toThrow(
      '"props[0].x" of "lamp" must be an integer within [0, 4), got -1.',
    );
  });

  it('rejects a prop whose floor names no existing floor', () => {
    expect(() => parseMapDocument(raw({ props: [prop({ floor: 'ghost-floor' })] }))).toThrow(
      '"props[0].floor" of "lamp" must reference an existing floor id, got "ghost-floor".',
    );
  });

  it('rejects a malformed object sha256', () => {
    expect(() => parseMapDocument(raw({ props: [prop({ object: 'not-a-sha' })] }))).toThrow(
      '"props[0].object" must be a 64-character lowercase hex sha256, got "not-a-sha".',
    );
    expect(() => parseMapDocument(raw({ props: [prop({ object: 'A'.repeat(64) })] }))).toThrow(
      /props\[0\]\.object.*sha256/,
    );
  });

  it('rejects scale <= 0 or non-finite scale', () => {
    expect(() => parseMapDocument(raw({ props: [prop({ scale: 0 })] }))).toThrow(
      '"props[0].scale" must be a finite number > 0, got 0.',
    );
    expect(() => parseMapDocument(raw({ props: [prop({ scale: -1 })] }))).toThrow(
      '"props[0].scale" must be a finite number > 0, got -1.',
    );
    expect(() => parseMapDocument(raw({ props: [prop({ scale: Number.NaN })] }))).toThrow(
      '"props[0].scale" must be a finite number > 0, got null.',
    );
  });

  it('rejects non-finite rotationY', () => {
    expect(() =>
      parseMapDocument(raw({ props: [prop({ rotationY: Number.POSITIVE_INFINITY })] })),
    ).toThrow('"props[0].rotationY" must be a finite number, got null.');
    expect(() => parseMapDocument(raw({ props: [prop({ rotationY: Number.NaN })] }))).toThrow(
      '"props[0].rotationY" must be a finite number, got null.',
    );
  });

  it('rejects an empty animation string when present', () => {
    expect(() => parseMapDocument(raw({ props: [prop({ animation: '' })] }))).toThrow(
      '"props[0].animation" must be a non-empty string when present, got "".',
    );
  });

  it('accepts two props on the same tile (deliberately allowed, unlike npcs)', () => {
    const doc = parseMapDocument(
      raw({
        props: [
          prop({ id: 'table', x: 2, y: 2, object: OBJECT_A }),
          prop({ id: 'lamp', x: 2, y: 2, object: OBJECT_B }),
        ],
      }),
    );
    expect(doc.props.map((p) => p.id)).toEqual(['table', 'lamp']);
  });

  it('rejects a non-array props value', () => {
    expect(() => parseMapDocument(raw({ props: {} }))).toThrow('"props" must be an array.');
  });
});

describe('map-format v5 tileset.tilePixelSize validation', () => {
  it('rejects a missing tilePixelSize', () => {
    expect(() =>
      parseMapDocument(raw({ tileset: { slots: {}, flags: [0], semantics: {} } })),
    ).toThrow(/tilePixelSize/);
  });

  it('rejects a non-integer tilePixelSize', () => {
    expect(() =>
      parseMapDocument(
        raw({ tileset: { slots: {}, flags: [0], semantics: {}, tilePixelSize: 48.5 } }),
      ),
    ).toThrow('"tileset.tilePixelSize" must be an integer in [8, 1024], got 48.5.');
  });

  it('rejects tilePixelSize below 8', () => {
    expect(() =>
      parseMapDocument(
        raw({ tileset: { slots: {}, flags: [0], semantics: {}, tilePixelSize: 4 } }),
      ),
    ).toThrow('"tileset.tilePixelSize" must be an integer in [8, 1024], got 4.');
  });

  it('rejects tilePixelSize above 1024', () => {
    expect(() =>
      parseMapDocument(
        raw({ tileset: { slots: {}, flags: [0], semantics: {}, tilePixelSize: 2048 } }),
      ),
    ).toThrow('"tileset.tilePixelSize" must be an integer in [8, 1024], got 2048.');
  });
});
