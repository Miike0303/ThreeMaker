/**
 * C1a tasks 2.1-2.3: the editor's half of the v4 anti-drop fan-out.
 *
 * `createBlankMapDocument`'s own literal in `src/` is compiler-enforced against
 * `MapDocument`, but `composeDocumentFromPainterFloors` carries narrative
 * content through an untyped `...docWithoutSpawn` spread -- nothing but these
 * tests notices if a collection stops surviving compose, or if a stale floor
 * reference survives one.
 *
 * The fixture literals in THIS file get no such enforcement: `tsconfig.json`
 * sets `include: ["src"]`, so no test file is in the typecheck graph, and vitest
 * transpiles without type-checking. The runtime assertions are the real guard.
 */
import type { MapDocument, NpcDocument, TriggerDocument } from '@threemaker/map-format';
import {
  CURRENT_MAP_FORMAT_VERSION,
  parseMapDocument,
  serializeMapDocument,
} from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  type CreateBlankMapDocumentOptions,
  composeDocumentFromPainterFloors,
  createBlankMapDocument,
  painterFloorsFromDocument,
} from '../src/map-compose.js';

const BLANK_OPTIONS: CreateBlankMapDocumentOptions = {
  id: 'v4-editor',
  name: 'V4 Editor',
  width: 4,
  height: 4,
  slots: {},
  flags: new Array(8192).fill(0),
};

const NPC: NpcDocument = {
  id: 'elder',
  x: 1,
  y: 1,
  floor: 'floor-0',
  facing: 'up',
  sprite: { object: 'a'.repeat(64), characterIndex: 3 },
  onInteract: 'talk-elder',
};

const TRIGGER: TriggerDocument = {
  id: 'gate',
  x: 2,
  y: 2,
  floor: 'floor-0',
  on: 'enter',
  event: 'open-gate',
};

/** A blank document with every narrative collection authored at a non-default value. */
function authoredDocument(): MapDocument {
  return {
    ...createBlankMapDocument(BLANK_OPTIONS),
    npcs: [NPC],
    triggers: [TRIGGER],
    events: {
      'talk-elder': [{ type: 'showDialogue', source: { kind: 'ink', storyId: 'elder' } }],
      'open-gate': [{ type: 'setWorldVar', key: 'gateOpen', value: true }],
    },
    worldSeeds: { gateOpen: false, coins: 3, lastNpc: 'elder' },
  };
}

describe('createBlankMapDocument (v4)', () => {
  it('round-trips as v4 with the four narrative collections at their defaults', () => {
    const blank = createBlankMapDocument(BLANK_OPTIONS);
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(blank)));

    expect(reparsed.version).toBe(CURRENT_MAP_FORMAT_VERSION);
    expect(reparsed).toEqual(blank);
    expect(reparsed.npcs).toEqual([]);
    expect(reparsed.triggers).toEqual([]);
    expect(reparsed.events).toEqual({});
    expect(reparsed.worldSeeds).toEqual({});
  });
});

describe('composeDocumentFromPainterFloors (v4 narrative content)', () => {
  it('preserves every narrative collection through compose -> serialize -> parse', () => {
    const doc = authoredDocument();
    const composed = composeDocumentFromPainterFloors(doc, painterFloorsFromDocument(doc));
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));

    expect(reparsed.npcs).toEqual([NPC]);
    expect(reparsed.triggers).toEqual([TRIGGER]);
    expect(reparsed.events).toEqual(doc.events);
    expect(reparsed.worldSeeds).toEqual(doc.worldSeeds);
    expect(reparsed).toEqual(composed);
  });

  it('drops npcs and triggers referencing a floor absent from the composed floors, so the result still parses', () => {
    const base = authoredDocument();
    const doc: MapDocument = {
      ...base,
      npcs: [...base.npcs, { ...NPC, id: 'ghost-npc', x: 3, y: 3, floor: 'floor-removed' }],
      triggers: [
        ...base.triggers,
        { ...TRIGGER, id: 'ghost-trigger', x: 0, y: 3, floor: 'floor-removed' },
      ],
    };

    // `painterFloorsFromDocument` only ever yields the document's REAL floors, so
    // `floor-removed` is absent from compose's floor-id set -- exactly the state
    // a painter "remove floor" leaves behind for rooms/stairLinks/spawn.
    const composed = composeDocumentFromPainterFloors(doc, painterFloorsFromDocument(doc));

    expect(composed.npcs.map((npc) => npc.id)).toEqual(['elder']);
    expect(composed.triggers.map((trigger) => trigger.id)).toEqual(['gate']);
    expect(() => parseMapDocument(JSON.parse(serializeMapDocument(composed)))).not.toThrow();
  });

  it('threads live events/worldSeeds; edited values survive compose→parse and stale-doc values are not resurrected', () => {
    const doc = authoredDocument();
    const floors = painterFloorsFromDocument(doc);
    const liveEvents = {
      'talk-elder': [
        { type: 'showDialogue' as const, source: { kind: 'text' as const, lines: ['Hello'] } },
      ],
      'new-evt': [{ type: 'setWorldVar' as const, key: 'fresh', value: true }],
    };
    const liveSeeds = { gateOpen: true, coins: 99 };

    const composed = composeDocumentFromPainterFloors(
      doc,
      floors,
      doc.rooms,
      doc.stairLinks,
      doc.spawn,
      doc.props,
      doc.npcs,
      doc.triggers,
      liveEvents,
      liveSeeds,
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));

    expect(reparsed.events).toEqual(liveEvents);
    expect(reparsed.worldSeeds).toEqual(liveSeeds);
    // Stale doc-only key `open-gate` must not reappear when live events replace it.
    expect(reparsed.events).not.toHaveProperty('open-gate');
    expect(reparsed.worldSeeds).not.toHaveProperty('lastNpc');
  });
});
