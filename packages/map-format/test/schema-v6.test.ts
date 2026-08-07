/**
 * Schema v6 acceptance (C6 WU-01): lights collection + per-floor lightMap,
 * plus the additive v5 -> v6 migration gate.
 *
 * Entry-level light / lightMap rejections live in `schema-v6-validation.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { migrateV5ToV6, parseMapDocument } from '../src/migrate.js';
import {
  CURRENT_MAP_FORMAT_VERSION,
  type LightDocument,
  MAP_FORMAT_MAGIC,
  type MapDocument,
  type MapLayers,
  type NpcDocument,
  serializeMapDocument,
} from '../src/schema.js';

const LAYER = [0, 0, 0, 0];
const LAYERS: MapLayers = { tiles: [LAYER, LAYER, LAYER, LAYER], shadows: LAYER, regions: LAYER };
const LIGHTMAP_SHA = 'c'.repeat(64);
const SPRITE_SHA = 'd'.repeat(64);
const V6_KEYS = ['lights'] as const;

const NPC: NpcDocument = {
  id: 'guard',
  x: 1,
  y: 0,
  floor: 'floor-0',
  facing: 'down',
  sprite: { object: SPRITE_SHA, characterIndex: 0 },
  onInteract: 'talk',
};

const PLACED_POINT: LightDocument = {
  id: 'ceiling-lamp',
  kind: 'point',
  color: '#ffaa00',
  intensity: 1.5,
  range: 4,
  x: 0,
  y: 0,
  floor: 'floor-0',
};

const ATTACHED_PLAYER: LightDocument = {
  id: 'player-torch',
  kind: 'point',
  color: '#ff8800',
  intensity: 1,
  range: 3,
  attach: 'player',
};

const ATTACHED_NPC: LightDocument = {
  id: 'npc-lantern',
  kind: 'point',
  color: '#88aaff',
  intensity: 0.8,
  range: 2.5,
  attach: 'guard',
};

const SPOT: LightDocument = {
  id: 'down-spot',
  kind: 'spot',
  color: '#ffffff',
  intensity: 2,
  range: 6,
  x: 1,
  y: 1,
  floor: 'floor-0',
  height: 2.5,
};

const BASE: MapDocument = {
  format: MAP_FORMAT_MAGIC,
  version: CURRENT_MAP_FORMAT_VERSION,
  id: 'v6-fixture',
  name: 'V6 Fixture',
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
  lights: [],
};

/** A valid v5-shaped raw document (no lights, no floor lightMap). */
function makeV5Raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { lights: _l, ...rest } = BASE as MapDocument & { lights?: unknown };
  return {
    ...rest,
    version: 5,
    props: [],
    floors: [
      { id: 'floor-0', baseElevation: 0, layers: LAYERS },
      { id: 'floor-1', baseElevation: 3, layers: LAYERS },
    ],
    ...overrides,
  };
}

describe('map-format v6 lights + floor lightMap preservation', () => {
  it('parses a placed point light', () => {
    const doc = parseMapDocument({ ...BASE, lights: [PLACED_POINT] });
    expect(doc.lights).toEqual([PLACED_POINT]);
  });

  it('parses an attached player torch', () => {
    const doc = parseMapDocument({ ...BASE, lights: [ATTACHED_PLAYER] });
    expect(doc.lights).toEqual([ATTACHED_PLAYER]);
  });

  it('parses an attached npc lantern when the npc exists', () => {
    const doc = parseMapDocument({ ...BASE, npcs: [NPC], lights: [ATTACHED_NPC] });
    expect(doc.lights).toEqual([ATTACHED_NPC]);
  });

  it('parses a spot light (direction/cone deferred; aims straight down by default)', () => {
    const doc = parseMapDocument({ ...BASE, lights: [SPOT] });
    expect(doc.lights).toEqual([SPOT]);
  });

  it('parses a floor with lightMap sha', () => {
    const doc = parseMapDocument({
      ...BASE,
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: LAYERS, lightMap: LIGHTMAP_SHA },
        { id: 'floor-1', baseElevation: 3, layers: LAYERS },
      ],
    });
    expect(doc.floors[0]?.lightMap).toBe(LIGHTMAP_SHA);
    expect(doc.floors[1]?.lightMap).toBeUndefined();
  });

  it('accepts an empty lights collection', () => {
    const doc = parseMapDocument(BASE);
    expect(doc.lights).toEqual([]);
  });

  it('round-trips parse(serialize(doc)) for all light forms + floor lightMap', () => {
    const input: MapDocument = {
      ...BASE,
      npcs: [NPC],
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: LAYERS, lightMap: LIGHTMAP_SHA },
        { id: 'floor-1', baseElevation: 3, layers: LAYERS },
      ],
      lights: [PLACED_POINT, ATTACHED_PLAYER, ATTACHED_NPC, SPOT],
    };

    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(input)));
    expect(reparsed).toEqual(input);
  });

  it('omits absent lightMap entirely from serialized JSON (never undefined-valued key)', () => {
    const json = serializeMapDocument(BASE);
    const parsed = JSON.parse(json) as {
      floors: Array<Record<string, unknown>>;
    };
    for (const floor of parsed.floors) {
      expect(Object.hasOwn(floor, 'lightMap')).toBe(false);
    }
  });

  it('two lights may share a tile (deliberately allowed, like props)', () => {
    const a: LightDocument = { ...PLACED_POINT, id: 'a', x: 1, y: 1 };
    const b: LightDocument = { ...PLACED_POINT, id: 'b', x: 1, y: 1, color: '#00ff00' };
    const doc = parseMapDocument({ ...BASE, lights: [a, b] });
    expect(doc.lights.map((light) => light.id)).toEqual(['a', 'b']);
  });
});

describe('map-format v5 -> v6 migration (additive, lossless)', () => {
  it('adds lights: []', () => {
    const v5 = makeV5Raw();
    const doc = parseMapDocument(v5);

    expect(doc.version).toBe(6);
    expect(doc.lights).toEqual([]);
    expect(Object.keys(doc)).toEqual(expect.arrayContaining([...V6_KEYS]));
  });

  it('migrateV5ToV6 directly: version 6, empty lights, drops nothing else', () => {
    const v5 = makeV5Raw({ id: 'hand-v5' });
    const migrated = migrateV5ToV6(v5);

    expect(migrated.version).toBe(6);
    expect(migrated.lights).toEqual([]);
    expect(migrated.id).toBe('hand-v5');
    expect(migrated.props).toEqual([]);
  });

  it('rejects a version-5 document that already carries lights instead of discarding it', () => {
    const v5 = makeV5Raw({ lights: [PLACED_POINT] });

    expect(() => parseMapDocument(v5)).toThrow(
      'Map document declares "version": 5 but already carries v6 content ("lights"). Set "version" to 6 -- the v5 -> v6 migration would otherwise discard it.',
    );
  });

  it('rejects a version-5 document that already carries a floor lightMap', () => {
    const v5 = makeV5Raw({
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: LAYERS, lightMap: LIGHTMAP_SHA },
        { id: 'floor-1', baseElevation: 3, layers: LAYERS },
      ],
    });

    expect(() => parseMapDocument(v5)).toThrow(
      'Map document declares "version": 5 but already carries v6 content ("lightMap"). Set "version" to 6 -- the v5 -> v6 migration would otherwise discard it.',
    );
  });

  it('names every v6 key found on a slipped version-5 document', () => {
    const v5 = makeV5Raw({
      lights: [],
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: LAYERS, lightMap: LIGHTMAP_SHA },
        { id: 'floor-1', baseElevation: 3, layers: LAYERS },
      ],
    });

    expect(() => parseMapDocument(v5)).toThrow('("lights", "lightMap")');
  });

  it('walks the full chain from the earliest supported version (v1) to v6', () => {
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
    expect(doc.version).toBe(6);
    expect(doc.lights).toEqual([]);
    expect(doc.props).toEqual([]);
    expect(doc.tileset.tilePixelSize).toBe(48);
    expect(doc.npcs).toEqual([]);
    expect(doc.rooms).toEqual([]);
  });
});
