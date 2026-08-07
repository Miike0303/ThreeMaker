/**
 * Schema v6 ENTRY-level validation (C6 WU-01): lights field rejections and
 * FloorDocument.lightMap sha256 checks.
 */
import { describe, expect, it } from 'vitest';
import { parseMapDocument } from '../src/migrate.js';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC, type MapLayers } from '../src/schema.js';

const LAYER: readonly number[] = new Array(4 * 4).fill(0);
const LAYERS: MapLayers = { tiles: [LAYER, LAYER, LAYER, LAYER], shadows: LAYER, regions: LAYER };
const SPRITE_SHA = 'd'.repeat(64);
const LIGHTMAP_SHA = 'c'.repeat(64);

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'v6-validation',
    name: 'V6 Validation',
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
    lights: [],
    ...overrides,
  };
}

/** Fully valid placed point light; each case invalidates exactly one field. */
function placed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lamp',
    kind: 'point',
    color: '#ffaa00',
    intensity: 1,
    range: 4,
    x: 1,
    y: 1,
    floor: 'floor-0',
    ...overrides,
  };
}

/** Fully valid attached light (player torch by default). */
function attached(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'torch',
    kind: 'point',
    color: '#ff8800',
    intensity: 1,
    range: 3,
    attach: 'player',
    ...overrides,
  };
}

const GUARD_NPC = {
  id: 'guard',
  x: 0,
  y: 0,
  floor: 'floor-0',
  facing: 'down',
  sprite: { object: SPRITE_SHA, characterIndex: 0 },
  onInteract: 'talk',
};

describe('map-format v6 lights validation', () => {
  it('rejects two lights with the same id, naming both entries', () => {
    expect(() =>
      parseMapDocument(
        raw({
          lights: [placed({ id: 'lamp', x: 0, y: 0 }), placed({ id: 'lamp', x: 1, y: 1 })],
        }),
      ),
    ).toThrow('"lights[1]" ("lamp") reuses the same id as "lights[0]".');
  });

  it('rejects a bad color format', () => {
    expect(() => parseMapDocument(raw({ lights: [placed({ color: '#FFAA00' })] }))).toThrow(
      '"lights[0].color" must be a lowercase #rrggbb hex color, got "#FFAA00".',
    );
    expect(() => parseMapDocument(raw({ lights: [placed({ color: 'red' })] }))).toThrow(
      '"lights[0].color" must be a lowercase #rrggbb hex color, got "red".',
    );
    expect(() => parseMapDocument(raw({ lights: [placed({ color: '#fff' })] }))).toThrow(
      '"lights[0].color" must be a lowercase #rrggbb hex color, got "#fff".',
    );
  });

  it('rejects intensity <= 0 or non-finite intensity', () => {
    expect(() => parseMapDocument(raw({ lights: [placed({ intensity: 0 })] }))).toThrow(
      '"lights[0].intensity" must be a finite number > 0, got 0.',
    );
    expect(() => parseMapDocument(raw({ lights: [placed({ intensity: -1 })] }))).toThrow(
      '"lights[0].intensity" must be a finite number > 0, got -1.',
    );
    expect(() => parseMapDocument(raw({ lights: [placed({ intensity: Number.NaN })] }))).toThrow(
      '"lights[0].intensity" must be a finite number > 0, got null.',
    );
  });

  it('rejects range <= 0 or non-finite range', () => {
    expect(() => parseMapDocument(raw({ lights: [placed({ range: 0 })] }))).toThrow(
      '"lights[0].range" must be a finite number > 0, got 0.',
    );
    expect(() => parseMapDocument(raw({ lights: [placed({ range: -2 })] }))).toThrow(
      '"lights[0].range" must be a finite number > 0, got -2.',
    );
    expect(() =>
      parseMapDocument(raw({ lights: [placed({ range: Number.POSITIVE_INFINITY })] })),
    ).toThrow('"lights[0].range" must be a finite number > 0, got null.');
  });

  it('rejects a light that carries both placed and attached forms', () => {
    expect(() =>
      parseMapDocument(
        raw({
          lights: [placed({ attach: 'player' })],
        }),
      ),
    ).toThrow(
      '"lights[0]" ("lamp") must be either placed (x, y, floor) or attached (attach), not both.',
    );
  });

  it('rejects a light that carries neither form', () => {
    expect(() =>
      parseMapDocument(
        raw({
          lights: [
            {
              id: 'orphan',
              kind: 'point',
              color: '#ffffff',
              intensity: 1,
              range: 2,
            },
          ],
        }),
      ),
    ).toThrow('"lights[0]" ("orphan") must be either placed (x, y, floor) or attached (attach).');
  });

  it('rejects attach to a missing npc id', () => {
    expect(() => parseMapDocument(raw({ lights: [attached({ attach: 'ghost-npc' })] }))).toThrow(
      '"lights[0].attach" of "torch" must be "player" or an existing npc id, got "ghost-npc".',
    );
  });

  it('rejects a placed light with a dangling floor', () => {
    expect(() => parseMapDocument(raw({ lights: [placed({ floor: 'ghost-floor' })] }))).toThrow(
      '"lights[0].floor" of "lamp" must reference an existing floor id, got "ghost-floor".',
    );
  });

  it('rejects an out-of-bounds tile for a placed light', () => {
    expect(() => parseMapDocument(raw({ lights: [placed({ x: 4 })] }))).toThrow(
      '"lights[0].x" of "lamp" must be an integer within [0, 4), got 4.',
    );
    expect(() => parseMapDocument(raw({ lights: [placed({ y: -1 })] }))).toThrow(
      '"lights[0].y" of "lamp" must be an integer within [0, 4), got -1.',
    );
  });

  it('rejects a negative height', () => {
    expect(() => parseMapDocument(raw({ lights: [placed({ height: -0.1 })] }))).toThrow(
      '"lights[0].height" must be a finite number >= 0, got -0.1.',
    );
  });

  it('rejects attach form that also carries height', () => {
    expect(() => parseMapDocument(raw({ lights: [attached({ height: 1 })] }))).toThrow(
      '"lights[0]" ("torch") must be either placed (x, y, floor) or attached (attach), not both.',
    );
  });

  it('rejects a non-array lights value', () => {
    expect(() => parseMapDocument(raw({ lights: {} }))).toThrow('"lights" must be an array.');
  });

  it('accepts attach to an existing npc id', () => {
    const doc = parseMapDocument(
      raw({
        npcs: [GUARD_NPC],
        lights: [attached({ id: 'npc-lantern', attach: 'guard' })],
      }),
    );
    expect(doc.lights[0]?.attach).toBe('guard');
  });
});

describe('map-format v6 floor lightMap validation', () => {
  it('rejects a bad lightMap sha', () => {
    expect(() =>
      parseMapDocument(
        raw({
          floors: [{ id: 'floor-0', baseElevation: 0, layers: LAYERS, lightMap: 'not-a-sha' }],
        }),
      ),
    ).toThrow('"floors[0].lightMap" must be a 64-character lowercase hex sha256, got "not-a-sha".');
  });

  it('accepts a valid lightMap sha', () => {
    const doc = parseMapDocument(
      raw({
        floors: [{ id: 'floor-0', baseElevation: 0, layers: LAYERS, lightMap: LIGHTMAP_SHA }],
      }),
    );
    expect(doc.floors[0]?.lightMap).toBe(LIGHTMAP_SHA);
  });
});
