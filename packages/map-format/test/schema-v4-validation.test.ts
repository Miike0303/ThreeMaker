/**
 * Schema v4 ENTRY-level validation (C1a task 1.2) plus the maximal-fixture
 * anti-drop gate (task 1.4).
 *
 * Task 1.1's `schema-v4.test.ts` pins per-leaf PRESERVATION; this file pins the
 * loud REJECTION of structurally-invalid authored entries. Between the v4
 * schema bump and this file, `parseMapDocument` validated the narrative
 * COLLECTIONS only and cast their entries unchecked -- a dangling floor
 * reference or an out-of-bounds NPC reached the runtime silently.
 */
import { describe, expect, it } from 'vitest';
import { parseMapDocument } from '../src/migrate.js';
import {
  CURRENT_MAP_FORMAT_VERSION,
  MAP_FORMAT_MAGIC,
  type MapDocument,
  type MapLayers,
  serializeMapDocument,
} from '../src/schema.js';

const LAYER: readonly number[] = new Array(4 * 4).fill(0);
const LAYERS: MapLayers = { tiles: [LAYER, LAYER, LAYER, LAYER], shadows: LAYER, regions: LAYER };
const SHEET_A = 'a'.repeat(64);
const SHEET_B = 'b'.repeat(64);

/** Raw (unvalidated) v4 document, 4x4 with TWO floors so floor-scoping is observable. */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'v4-validation',
    name: 'V4 Validation',
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

/** A fully valid raw NPC entry; each case below invalidates exactly one field. */
function npc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'elder',
    x: 1,
    y: 1,
    floor: 'floor-0',
    facing: 'down',
    sprite: { object: SHEET_A, characterIndex: 1 },
    onInteract: 'talk-elder',
    ...overrides,
  };
}

/** A fully valid raw trigger entry; each case below invalidates exactly one field. */
function trigger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gate',
    x: 2,
    y: 2,
    floor: 'floor-0',
    on: 'enter',
    event: 'open-gate',
    ...overrides,
  };
}

describe('map-format v4 entry-level validation (task 1.2)', () => {
  it('rejects an npc whose floor names no existing floor, naming the npc id and the missing floor', () => {
    expect(() => parseMapDocument(raw({ npcs: [npc({ floor: 'ghost-floor' })] }))).toThrow(
      '"npcs[0].floor" of "elder" must reference an existing floor id, got "ghost-floor".',
    );
  });

  it('rejects a trigger whose floor names no existing floor, naming the trigger id and the missing floor', () => {
    expect(() => parseMapDocument(raw({ triggers: [trigger({ floor: 'ghost-floor' })] }))).toThrow(
      '"triggers[0].floor" of "gate" must reference an existing floor id, got "ghost-floor".',
    );
  });

  it('rejects an npc whose x or y falls outside the map bounds', () => {
    expect(() => parseMapDocument(raw({ npcs: [npc({ x: 4 })] }))).toThrow(
      '"npcs[0].x" of "elder" must be an integer within [0, 4), got 4.',
    );
    expect(() => parseMapDocument(raw({ npcs: [npc({ y: -1 })] }))).toThrow(
      '"npcs[0].y" of "elder" must be an integer within [0, 4), got -1.',
    );
  });

  it('rejects a trigger whose x or y falls outside the map bounds', () => {
    expect(() => parseMapDocument(raw({ triggers: [trigger({ x: 9 })] }))).toThrow(
      '"triggers[0].x" of "gate" must be an integer within [0, 4), got 9.',
    );
    expect(() => parseMapDocument(raw({ triggers: [trigger({ y: 4 })] }))).toThrow(
      '"triggers[0].y" of "gate" must be an integer within [0, 4), got 4.',
    );
  });

  it('rejects two npcs on the same tile of the same floor, naming both entries', () => {
    expect(() =>
      parseMapDocument(
        raw({ npcs: [npc({ id: 'villager', x: 3, y: 3 }), npc({ id: 'imposter', x: 3, y: 3 })] }),
      ),
    ).toThrow(
      '"npcs[1]" ("imposter") occupies the same tile (3,3) on floor "floor-0" as "npcs[0]".',
    );
  });

  it('rejects two npcs with the same id, naming both entries (C1a follow-up)', () => {
    expect(() =>
      parseMapDocument(
        raw({
          npcs: [npc({ id: 'elder', x: 0, y: 0 }), npc({ id: 'elder', x: 1, y: 1 })],
        }),
      ),
    ).toThrow('"npcs[1]" ("elder") reuses the same id as "npcs[0]".');
  });

  it('accepts two npcs with different ids on different tiles', () => {
    const doc = parseMapDocument(
      raw({
        npcs: [npc({ id: 'elder', x: 0, y: 0 }), npc({ id: 'guard', x: 1, y: 1 })],
      }),
    );
    expect(doc.npcs.map((n) => n.id)).toEqual(['elder', 'guard']);
  });

  it('rejects two triggers with the same id', () => {
    expect(() =>
      parseMapDocument(
        raw({
          triggers: [trigger({ id: 'gate', x: 0, y: 0 }), trigger({ id: 'gate', x: 1, y: 1 })],
        }),
      ),
    ).toThrow('"triggers[1]" ("gate") reuses the same id as "triggers[0]".');
  });

  it('accepts two npcs on the same x,y of DIFFERENT floors (tile identity is floor-scoped)', () => {
    const doc = parseMapDocument(
      raw({
        npcs: [npc({ id: 'ground', floor: 'floor-0' }), npc({ id: 'upstairs', floor: 'floor-1' })],
      }),
    );
    expect(doc.npcs.map((entry) => entry.floor)).toEqual(['floor-0', 'floor-1']);
  });

  it('rejects npc sprite.object that is not a 64-char lowercase hex sha256', () => {
    expect(() =>
      parseMapDocument(
        raw({ npcs: [npc({ sprite: { object: 'not-a-sha', characterIndex: 0 } })] }),
      ),
    ).toThrow(/sprite\.object.*sha256|64/);
    expect(() =>
      parseMapDocument(
        raw({
          npcs: [npc({ sprite: { object: 'A'.repeat(64), characterIndex: 0 } })],
        }),
      ),
    ).toThrow(/sprite\.object/);
  });

  it('accepts npc sprite.object as a 64-char lowercase hex sha256', () => {
    const doc = parseMapDocument(
      raw({ npcs: [npc({ sprite: { object: 'ab'.repeat(32), characterIndex: 0 } })] }),
    );
    expect(doc.npcs[0]?.sprite.object).toBe('ab'.repeat(32));
  });

  it('rejects a non-primitive worldSeeds value', () => {
    expect(() => parseMapDocument(raw({ worldSeeds: { progress: { chapter: 1 } } }))).toThrow(
      '"worldSeeds.progress" must be a boolean, number, or string, got {"chapter":1}.',
    );
  });

  it("rejects a malformed events command through core's parseEventScript", () => {
    expect(() => parseMapDocument(raw({ events: { 'open-gate': [{ type: 'nope' }] } }))).toThrow(
      '"events" is not a valid event script: Invalid Event Script: events.open-gate[0] has unknown command type "nope".',
    );
  });

  // Every other collection in `validateCurrentVersionShape` is rebuilt from
  // scratch, so a parsed document shares no mutable state with the untrusted
  // input JSON. `worldSeeds` was the one exception: it was returned by
  // reference, so a document presented as validated and `readonly` could still
  // be mutated through the caller's own input object after the fact.
  it('does not alias the caller worldSeeds object into the parsed document', () => {
    const seeds: Record<string, unknown> = { doorOpen: false, coins: 3 };

    const doc = parseMapDocument(raw({ worldSeeds: seeds }));
    seeds.doorOpen = true;
    seeds.coins = 999;
    seeds.injectedAfterValidation = 'unvalidated';

    expect(doc.worldSeeds).toEqual({ doorOpen: false, coins: 3 });
  });
});

/**
 * One fixture with ALL 18 leaves of the closed v4 field list populated at
 * non-default values, plus every pre-existing optional key (`label`, `spawn`,
 * `name`, slot sources, semantics). Follows the v2 -> v3 gate pattern
 * (`migrate.test.ts`'s "full-document-equality roundtrip").
 *
 * The `MapDocument` annotation here buys NO compiler enforcement: this
 * package's `tsconfig.json` sets `include: ["src"]`, so no test file is in the
 * typecheck graph, and vitest transpiles without type-checking. The runtime
 * `toEqual` assertions below are the real and only guard.
 */
const MAXIMAL: MapDocument = {
  format: MAP_FORMAT_MAGIC,
  version: CURRENT_MAP_FORMAT_VERSION,
  id: 'v4-maximal',
  name: 'V4 Maximal',
  width: 4,
  height: 4,
  tileset: {
    slots: { A1: { object: SHEET_A, sourceTilesetId: 7, sourceGameId: 2 } },
    flags: [0],
    semantics: { '5': { class: 'wall' } },
    tilePixelSize: 48,
  },
  floors: [
    { id: 'floor-0', label: 'Ground', baseElevation: 0, layers: LAYERS },
    { id: 'floor-1', baseElevation: 3, layers: LAYERS },
  ],
  stairLinks: [
    {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      bidirectional: true,
      waypoints: [
        { x: 0, y: 0, floor: 'floor-0' },
        { x: 0, y: 1, floor: 'floor-1' },
      ],
    },
  ],
  rooms: [
    { id: 'hall', name: 'Hall', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 2, height: 2 }] },
  ],
  spawn: { x: 0, y: 0, floor: 'floor-0' },
  // Same x,y on two floors: deliberate, so the maximal fixture also exercises
  // the floor-scoped duplicate-tile key rather than a global x,y key.
  npcs: [
    {
      id: 'elder',
      x: 1,
      y: 1,
      floor: 'floor-0',
      facing: 'up',
      sprite: { object: SHEET_A, characterIndex: 3 },
      onInteract: 'talk-elder',
    },
    {
      id: 'guard',
      x: 1,
      y: 1,
      floor: 'floor-1',
      facing: 'left',
      sprite: { object: SHEET_B, characterIndex: 5 },
      onInteract: 'talk-guard',
    },
  ],
  triggers: [
    { id: 'gate', x: 2, y: 2, floor: 'floor-0', on: 'enter', event: 'open-gate' },
    { id: 'sign', x: 3, y: 3, floor: 'floor-1', on: 'interact', event: 'read-sign' },
  ],
  events: {
    'talk-elder': [
      {
        type: 'showDialogue',
        speaker: 'Elder',
        source: { kind: 'ink', storyId: 'elder', knot: 'start' },
      },
    ],
    'talk-guard': [{ type: 'setWorldVar', key: 'greeted', value: true }],
    'open-gate': [{ type: 'moveEntity', entityId: 'player', direction: 'up', steps: 2 }],
    'read-sign': [{ type: 'showDialogue', source: { kind: 'text', lines: ['Beware.'] } }],
  },
  worldSeeds: { doorOpen: false, coins: 7, lastNpc: 'elder' },
  props: [],
  lights: [],
};

describe('map-format v4 maximal-fixture anti-drop gate (task 1.4)', () => {
  it('round-trips a document with all 18 v4 leaves populated', () => {
    expect(parseMapDocument(JSON.parse(serializeMapDocument(MAXIMAL)))).toEqual(MAXIMAL);
  });
});
