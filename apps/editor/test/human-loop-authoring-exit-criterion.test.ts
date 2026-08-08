/**
 * L2 exit criterion (GOAL_NEXT / LOOP_NEXT) — **authoring half** of the human
 * create→play loop: blank map → spawn + NPC + interact trigger + transfer
 * trigger + form-authored events + worldSeeds, all via painter-store / form
 * helpers (no hand JSON on the blank document), compose → parse round-trip.
 *
 * Play half (runtime hop, inventory, ink) remains covered by desktop
 * exit-criterion suites (stats-inventory, map-transfer, authored-narrative).
 * This test proves a human can *build* that project shape in the editor path.
 */

import { parseEventScript } from '@threemaker/core';
import { parseMapDocument, serializeMapDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  canSavePainterDocument,
  dialogueLinesFromTextarea,
  parseIntField,
  parseWorldValue,
} from '../src/event-form-helpers.js';
import {
  type CreateBlankMapDocumentOptions,
  composeDocumentFromPainterFloors,
  createBlankMapDocument,
  painterFloorsFromDocument,
} from '../src/map-compose.js';
import {
  addCommand,
  addEvent,
  createPainterState,
  placeNpc,
  placeTrigger,
  setActiveNpcSpriteObject,
  setActiveTriggerOn,
  setSpawn,
  setWorldSeed,
  updateCommand,
} from '../src/painter-store.js';

const BLANK_OPTIONS: CreateBlankMapDocumentOptions = {
  id: 'human-loop-authoring-exit',
  name: 'Human Loop Authoring Exit',
  width: 8,
  height: 8,
  slots: {},
  flags: new Array(8192).fill(0),
};

const SPRITE = 'b'.repeat(64);
const EVENT_TALK = 'elder_talk';
const EVENT_CHEST = 'chest_open';
const EVENT_HOP = 'to_map_b';

describe('exit criterion: human loop authoring (spawn/NPC/trigger/events/transfer)', () => {
  it('authors a full playable map document without pre-seeded events on the blank map', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    expect(doc.events).toEqual({});
    expect(doc.npcs).toEqual([]);
    expect(doc.triggers).toEqual([]);
    expect(doc.spawn).toBeUndefined();

    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
    });

    // --- Spawn tool ---
    state = setSpawn(state, { x: 2, y: 2, floor: 'floor-0' });

    // --- Events (forms) ---
    state = addEvent(state, EVENT_TALK);
    state = addCommand(state, EVENT_TALK, [0], 'showDialogue');
    state = updateCommand(state, EVENT_TALK, [0], {
      source: {
        kind: 'text',
        lines: dialogueLinesFromTextarea('Hello traveler.'),
      },
    });

    state = addEvent(state, EVENT_CHEST);
    state = addCommand(state, EVENT_CHEST, [0], 'conditional');
    state = updateCommand(state, EVENT_CHEST, [0], {
      if: { key: 'chest_opened', op: 'eq', value: parseWorldValue('boolean', 'false') },
    });
    state = addCommand(state, EVENT_CHEST, [0, 'then', 0], 'giveItem');
    state = updateCommand(state, EVENT_CHEST, [0, 'then', 0], {
      itemId: 'brass_key',
      amount: parseIntField('1', 1),
    });
    state = addCommand(state, EVENT_CHEST, [0, 'then', 1], 'setWorldVar');
    state = updateCommand(state, EVENT_CHEST, [0, 'then', 1], {
      key: 'chest_opened',
      value: parseWorldValue('boolean', 'true'),
    });
    state = addCommand(state, EVENT_CHEST, [0, 'then', 2], 'showDialogue');
    state = updateCommand(state, EVENT_CHEST, [0, 'then', 2], {
      source: {
        kind: 'text',
        lines: dialogueLinesFromTextarea('You found a brass key.'),
      },
    });
    state = addCommand(state, EVENT_CHEST, [0, 'else', 0], 'showDialogue');
    state = updateCommand(state, EVENT_CHEST, [0, 'else', 0], {
      source: {
        kind: 'text',
        lines: dialogueLinesFromTextarea('The chest is empty.'),
      },
    });

    state = addEvent(state, EVENT_HOP);
    state = addCommand(state, EVENT_HOP, [0], 'transferMap');
    state = updateCommand(state, EVENT_HOP, [0], {
      mapFile: 'map-b.tmmap.json',
      x: parseIntField('3', 0),
      y: parseIntField('3', 0),
      facing: 'down',
    });

    state = setWorldSeed(state, 'chest_opened', false);

    // --- Placement tools ---
    state = setActiveNpcSpriteObject(state, SPRITE);
    state = { ...state, activeNpcEventKey: EVENT_TALK };
    state = placeNpc(state, { x: 5, y: 5 });

    state = setActiveTriggerOn(state, 'interact');
    state = { ...state, activeTriggerEventKey: EVENT_CHEST };
    state = placeTrigger(state, { x: 1, y: 1 });

    state = setActiveTriggerOn(state, 'enter');
    state = { ...state, activeTriggerEventKey: EVENT_HOP };
    state = placeTrigger(state, { x: 7, y: 4 });

    expect(canSavePainterDocument(state)).toBeNull();

    const composed = composeDocumentFromPainterFloors(
      doc,
      state.floors,
      state.rooms,
      state.stairLinks,
      state.spawn,
      state.props,
      state.npcs,
      state.triggers,
      state.events,
      state.worldSeeds,
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));

    expect(reparsed.spawn).toEqual({ x: 2, y: 2, floor: 'floor-0' });
    expect(reparsed.npcs).toHaveLength(1);
    expect(reparsed.npcs[0]?.onInteract).toBe(EVENT_TALK);
    expect(reparsed.triggers).toHaveLength(2);
    expect(reparsed.triggers.find((t) => t.event === EVENT_CHEST)?.on).toBe('interact');
    expect(reparsed.triggers.find((t) => t.event === EVENT_HOP)?.on).toBe('enter');
    expect(reparsed.events[EVENT_HOP]).toEqual([
      {
        type: 'transferMap',
        mapFile: 'map-b.tmmap.json',
        x: 3,
        y: 3,
        facing: 'down',
      },
    ]);
    expect(reparsed.worldSeeds).toEqual({ chest_opened: false });
    expect(() => parseEventScript({ version: 1, events: reparsed.events })).not.toThrow();
  });
});
