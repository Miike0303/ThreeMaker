/**
 * C1a task 1.8: the 24 cases of `packages/gameplay/test/parse-npcs.test.ts`
 * (14) and `parse-triggers.test.ts` (10), ported onto `parseMapDocument`.
 *
 * v4 moves NPC/trigger validation from two standalone sidecar-file parsers into
 * the map document itself, so each ported case keeps its ORIGINAL test name (for
 * traceability against the files it replaces) while asserting the v4 surface.
 * The two source files were DELETED in task 7.2 once their last importer went
 * with the DEV demo content path, so these 24 cases are now the only home for
 * that coverage -- the original names above are a historical trail, not a live
 * path.
 *
 * Shape changes the ports had to absorb, recorded rather than dropped silently:
 *
 * | Original case | v4 analogue |
 * |---|---|
 * | `"version" must be 1` (x2) | NONE at the collection level -- v4 has no per-collection envelope. The nearest real analogue is the DOCUMENT's version dispatch, asserted here with an unsupported version. |
 * | `expected an object` root guard (x2) | NONE at the collection level, same reason. Ported onto the document envelope guard in `parseMapDocument`. |
 * | `sprite.sheet` must be a string | Renamed: v4 is content-addressed, so the field is `sprite.object` (a sha256), mirroring `ManifestActorSheet`. |
 * | `sprite.index` must be an integer | Renamed to `sprite.characterIndex`, same reason. |
 * | two npcs occupy the same tile | Now floor-SCOPED: the same x,y on two floors is two distinct tiles (see `schema-v4-validation.test.ts`). |
 * | (new in v4, no original) | `floor` must reference an existing floor id -- covered by task 1.2, not duplicated here. |
 *
 * A field written as `undefined` below stands in for an absent key: every check
 * these cases exercise is a `typeof` guard, so the two are indistinguishable to
 * the validator and the override helpers stay readable.
 */
import { describe, expect, it } from 'vitest';
import { parseMapDocument } from '../src/migrate.js';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC, type MapLayers } from '../src/schema.js';

const LAYER: readonly number[] = new Array(8 * 8).fill(0);
const LAYERS: MapLayers = { tiles: [LAYER, LAYER, LAYER, LAYER], shadows: LAYER, regions: LAYER };
const SHEET = 'a'.repeat(64);

/** 8x8 so every original fixture's coordinates (x: 3, y: 4) stay in bounds. */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'ports-map',
    name: 'Ports Map',
    width: 8,
    height: 8,
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

function npc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'elder',
    x: 3,
    y: 4,
    floor: 'floor-0',
    facing: 'down',
    sprite: { object: SHEET, characterIndex: 1 },
    onInteract: 'elder-intro',
    ...overrides,
  };
}

function trigger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gate',
    x: 3,
    y: 4,
    floor: 'floor-0',
    on: 'enter',
    event: 'gate-open',
    ...overrides,
  };
}

type FailureCase = readonly [string, () => unknown, string];

describe('parseNpcs cases ported to parseMapDocument (14)', () => {
  it('parses a valid npcs file', () => {
    expect(parseMapDocument(raw({ npcs: [npc()] })).npcs).toEqual([
      {
        id: 'elder',
        x: 3,
        y: 4,
        floor: 'floor-0',
        facing: 'down',
        sprite: { object: SHEET, characterIndex: 1 },
        onInteract: 'elder-intro',
      },
    ]);
  });

  it('parses an empty npcs array', () => {
    expect(parseMapDocument(raw({ npcs: [] })).npcs).toEqual([]);
  });

  const FAILURES: readonly FailureCase[] = [
    [
      'throws when the root is not an object',
      () => parseMapDocument('not-an-object'),
      'Map document must be a non-null object.',
    ],
    [
      'throws when "version" is not 1',
      () => parseMapDocument(raw({ version: 99, npcs: [npc()] })),
      `Map document version 99 is newer than the current supported version ${CURRENT_MAP_FORMAT_VERSION}. Upgrade the app to open it.`,
    ],
    [
      'throws when "npcs" is not an array',
      () => parseMapDocument(raw({ npcs: {} })),
      '"npcs" must be an array.',
    ],
    [
      'throws when an npc is missing "id"',
      () => parseMapDocument(raw({ npcs: [npc({ id: undefined })] })),
      '"npcs[0].id" must be a non-empty string.',
    ],
    [
      'throws when an npc is missing "onInteract"',
      () => parseMapDocument(raw({ npcs: [npc({ onInteract: undefined })] })),
      '"npcs[0].onInteract" must be a non-empty string.',
    ],
    [
      'throws on an invalid "facing" value',
      () => parseMapDocument(raw({ npcs: [npc({ facing: 'north' })] })),
      '"npcs[0].facing" must be one of down, left, right, up, got "north".',
    ],
    [
      'throws on non-integer "x"',
      () => parseMapDocument(raw({ npcs: [npc({ x: 3.5 })] })),
      '"npcs[0].x" of "elder" must be an integer within [0, 8), got 3.5.',
    ],
    [
      'throws on non-integer "y"',
      () => parseMapDocument(raw({ npcs: [npc({ y: 'four' })] })),
      '"npcs[0].y" of "elder" must be an integer within [0, 8), got "four".',
    ],
    [
      'throws when "sprite" is missing',
      () => parseMapDocument(raw({ npcs: [npc({ sprite: undefined })] })),
      '"npcs[0].sprite" must be an object.',
    ],
    [
      'throws when "sprite.object" is not a string (was "sprite.sheet")',
      () => parseMapDocument(raw({ npcs: [npc({ sprite: { object: 1, characterIndex: 1 } })] })),
      '"npcs[0].sprite.object" must be a 64-character lowercase hex sha256, got 1.',
    ],
    [
      'throws when "sprite.characterIndex" is not an integer (was "sprite.index")',
      () =>
        parseMapDocument(raw({ npcs: [npc({ sprite: { object: SHEET, characterIndex: 1.5 } })] })),
      '"npcs[0].sprite.characterIndex" must be a non-negative integer, got 1.5.',
    ],
    [
      'throws when two npcs occupy the same tile',
      () =>
        parseMapDocument(
          raw({
            npcs: [
              npc({ id: 'villager', x: 1, y: 1 }),
              npc({ id: 'guard', x: 4, y: 7 }),
              npc({ id: 'merchant', x: 2, y: 2 }),
              npc({ id: 'imposter', x: 4, y: 7 }),
            ],
          }),
        ),
      '"npcs[3]" ("imposter") occupies the same tile (4,7) on floor "floor-0" as "npcs[1]".',
    ],
  ];

  it.each(FAILURES)('%s', (_name, run, message) => {
    expect(run).toThrow(message);
  });
});

describe('parseTriggers cases ported to parseMapDocument (10)', () => {
  it('parses a valid triggers file', () => {
    expect(parseMapDocument(raw({ triggers: [trigger()] })).triggers).toEqual([
      { id: 'gate', x: 3, y: 4, floor: 'floor-0', on: 'enter', event: 'gate-open' },
    ]);
  });

  it('parses an empty triggers array', () => {
    expect(parseMapDocument(raw({ triggers: [] })).triggers).toEqual([]);
  });

  const FAILURES: readonly FailureCase[] = [
    [
      'throws when the root is not an object',
      () => parseMapDocument(42),
      'Map document must be a non-null object.',
    ],
    [
      'throws when "version" is not 1',
      () => parseMapDocument(raw({ version: 99, triggers: [trigger()] })),
      `Map document version 99 is newer than the current supported version ${CURRENT_MAP_FORMAT_VERSION}. Upgrade the app to open it.`,
    ],
    [
      'throws when "triggers" is not an array',
      () => parseMapDocument(raw({ triggers: 'nope' })),
      '"triggers" must be an array.',
    ],
    [
      'throws when a trigger is missing "id"',
      () => parseMapDocument(raw({ triggers: [trigger({ id: undefined })] })),
      '"triggers[0].id" must be a non-empty string.',
    ],
    [
      'throws when a trigger is missing "event"',
      () => parseMapDocument(raw({ triggers: [trigger({ event: undefined })] })),
      '"triggers[0].event" must be a non-empty string.',
    ],
    [
      'throws on non-integer "x"',
      () => parseMapDocument(raw({ triggers: [trigger({ x: 3.2 })] })),
      '"triggers[0].x" of "gate" must be an integer within [0, 8), got 3.2.',
    ],
    [
      'throws on non-integer "y"',
      () => parseMapDocument(raw({ triggers: [trigger({ y: null })] })),
      '"triggers[0].y" of "gate" must be an integer within [0, 8), got null.',
    ],
    [
      'throws on an invalid "on" value',
      () => parseMapDocument(raw({ triggers: [trigger({ on: 'leave' })] })),
      '"triggers[0].on" must be one of enter, interact, got "leave".',
    ],
  ];

  it.each(FAILURES)('%s', (_name, run, message) => {
    expect(run).toThrow(message);
  });
});
