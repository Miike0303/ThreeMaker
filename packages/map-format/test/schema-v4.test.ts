/**
 * Schema v4 acceptance (C1a tasks 1.1 and 1.3a): one round-trip case per leaf
 * of the CLOSED v4 field list, so an unmirrored field in
 * `validateCurrentVersionShape`'s rebuilt literal fails a NAMED test instead of
 * being dropped silently -- plus the additive v3 -> v4 migration gate.
 *
 * Entry-level validation errors (dangling floor refs, out-of-bounds tiles,
 * duplicate NPC tiles, non-primitive seeds, malformed commands) are a separate
 * work unit; this file pins preservation and migration defaults only.
 */
import { describe, expect, it } from 'vitest';
import { parseMapDocument } from '../src/migrate.js';
import {
  CURRENT_MAP_FORMAT_VERSION,
  MAP_FORMAT_MAGIC,
  type MapDocument,
  type MapLayers,
  type NpcDocument,
  serializeMapDocument,
  type TriggerDocument,
} from '../src/schema.js';

const LAYER = [0, 0, 0, 0];
const LAYERS: MapLayers = { tiles: [LAYER, LAYER, LAYER, LAYER], shadows: LAYER, regions: LAYER };
const SHEET_A = 'a'.repeat(64);
const SHEET_B = 'b'.repeat(64);
const NARRATIVE_KEYS = ['npcs', 'triggers', 'events', 'worldSeeds'] as const;

/** Every leaf at its zero/default value, so each case below changes exactly one. */
const NPC: NpcDocument = {
  id: 'npc-0',
  x: 0,
  y: 0,
  floor: 'floor-0',
  facing: 'down',
  sprite: { object: SHEET_A, characterIndex: 0 },
  onInteract: 'event-0',
};

const TRIGGER: TriggerDocument = {
  id: 'trigger-0',
  x: 0,
  y: 0,
  floor: 'floor-0',
  on: 'enter',
  event: 'event-0',
};

/** Carries `spawn`, so these cases exercise the SECOND literal branch of `validateCurrentVersionShape`. */
const BASE: MapDocument = {
  format: MAP_FORMAT_MAGIC,
  version: CURRENT_MAP_FORMAT_VERSION,
  id: 'v4-fixture',
  name: 'V4 Fixture',
  width: 2,
  height: 2,
  tileset: { slots: {}, flags: [0], semantics: {} },
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
};

function npc(patch: Partial<NpcDocument>): Partial<MapDocument> {
  return { npcs: [{ ...NPC, ...patch }] };
}

function trigger(patch: Partial<TriggerDocument>): Partial<MapDocument> {
  return { triggers: [{ ...TRIGGER, ...patch }] };
}

const CASES: readonly (readonly [string, Partial<MapDocument>])[] = [
  ['npcs', { npcs: [NPC] }],
  ['npcs[].id', npc({ id: 'npc-elder' })],
  ['npcs[].x', npc({ x: 1 })],
  ['npcs[].y', npc({ y: 1 })],
  ['npcs[].floor', npc({ floor: 'floor-1' })],
  ['npcs[].facing', npc({ facing: 'up' })],
  ['npcs[].sprite.object', npc({ sprite: { object: SHEET_B, characterIndex: 0 } })],
  ['npcs[].sprite.characterIndex', npc({ sprite: { object: SHEET_A, characterIndex: 5 } })],
  ['npcs[].onInteract', npc({ onInteract: 'talk-elder' })],
  ['triggers', { triggers: [TRIGGER] }],
  ['triggers[].id', trigger({ id: 'trigger-door' })],
  ['triggers[].x', trigger({ x: 1 })],
  ['triggers[].y', trigger({ y: 1 })],
  ['triggers[].floor', trigger({ floor: 'floor-1' })],
  ['triggers[].on', trigger({ on: 'interact' })],
  ['triggers[].event', trigger({ event: 'open-door' })],
  // A REAL `EventCommand` since task 1.6: `events` is validated through core's
  // `parseEventScript`, so a hand-waved command shape no longer parses.
  [
    'events',
    {
      events: {
        'open-door': [
          { type: 'showDialogue', source: { kind: 'ink', storyId: 'door', knot: 'start' } },
        ],
      },
    },
  ],
  ['worldSeeds', { worldSeeds: { doorOpen: false, coins: 3, lastNpc: 'npc-0' } }],
];

describe('map-format v4 closed field list (18 leaves, one case each)', () => {
  it.each(CASES)('preserves %s across serialize -> parse', (_leaf, patch) => {
    const input: MapDocument = { ...BASE, ...patch };
    expect(parseMapDocument(JSON.parse(serializeMapDocument(input)))).toEqual(input);
  });
});

describe('map-format v3 -> v4 migration (additive, lossless)', () => {
  it('adds the four collections at their empty defaults and keeps every v3 key identical', () => {
    const v3: Record<string, unknown> = { ...BASE, version: 3 };
    for (const key of NARRATIVE_KEYS) delete v3[key];

    const doc = parseMapDocument(v3);

    expect(doc.version).toBe(4);
    // Present, not `undefined`-vs-missing mismatched (spec R1).
    expect(Object.keys(doc)).toEqual(expect.arrayContaining([...NARRATIVE_KEYS]));
    expect(doc.npcs).toEqual([]);
    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
    expect(doc.worldSeeds).toEqual({});

    const preExisting = { ...doc } as Record<string, unknown>;
    for (const key of NARRATIVE_KEYS) delete preExisting[key];
    expect(preExisting).toEqual({ ...v3, version: 4 });
  });

  // The migration is spread-then-overwrite, so a hand-authored map that carries
  // real narrative content while still DECLARING `version: 3` (a one-character
  // authoring slip) used to migrate "successfully" with every NPC, trigger,
  // event and seed silently discarded -- the "silently narrative-free map"
  // degradation spec R5 forbids, with no error at any layer. Verified against
  // the 848 real v3 documents on disk: none carries any of these four keys, so
  // failing loudly here cannot reject real data.
  it('rejects a version-3 document that already carries narrative content instead of discarding it', () => {
    const v3: Record<string, unknown> = { ...BASE, version: 3, npcs: [NPC], worldSeeds: { a: 1 } };
    v3.triggers = undefined;
    v3.events = undefined;

    expect(() => parseMapDocument(v3)).toThrow(
      'Map document declares "version": 3 but already carries v4 narrative content ("npcs", "worldSeeds"). Set "version" to 4 -- the v3 -> v4 migration would otherwise discard it.',
    );
  });

  it('names every narrative key found on a slipped version-3 document', () => {
    const v3: Record<string, unknown> = {
      ...BASE,
      version: 3,
      npcs: [NPC],
      triggers: [TRIGGER],
      events: {},
      worldSeeds: {},
    };

    expect(() => parseMapDocument(v3)).toThrow('("npcs", "triggers", "events", "worldSeeds")');
  });
});
