/**
 * L1 exit criterion (GOAL_NEXT / LOOP_NEXT): events authored **only** via the
 * same store + form-helper seams `PainterPanel` / `CommandForm` use — never a
 * hand-built `events: { ... }` object on the blank map — then compose/save
 * shape is load-valid and save hard-gate matches live validation.
 *
 * Covers giveItem + showDialogue (text) + conditional, the three kinds the
 * goal names for smoke. Desktop play of this shape lives in
 * `apps/desktop/test/events-editor-playable-exit-criterion.test.ts`.
 *
 * Neighbours:
 * - `event-form-helpers.test.ts` — pure field parse / save gate units.
 * - `painter-store.test.ts` — command path CRUD units.
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
  setWorldSeed,
  updateCommand,
  validateEventsDraft,
} from '../src/painter-store.js';

const BLANK_OPTIONS: CreateBlankMapDocumentOptions = {
  id: 'events-editor-exit',
  name: 'Events Editor Exit Criterion',
  width: 6,
  height: 6,
  slots: {},
  flags: new Array(8192).fill(0),
};

const SPRITE = 'a'.repeat(64);
const EVENT_CHEST = 'chest_open';
const EVENT_GREET = 'greet';

/** Author chest_open the way CommandForm does: default command → field patches. */
function authorChestOpen(state: ReturnType<typeof createPainterState>) {
  let next = addEvent(state, EVENT_CHEST);
  // Root conditional (kind picker → add).
  next = addCommand(next, EVENT_CHEST, [0], 'conditional');
  // Form: if key / op / value (boolean seed false via parseWorldValue).
  next = updateCommand(next, EVENT_CHEST, [0], {
    if: {
      key: 'chest_opened',
      op: 'eq',
      value: parseWorldValue('boolean', 'false'),
    },
  });
  // then: giveItem
  next = addCommand(next, EVENT_CHEST, [0, 'then', 0], 'giveItem');
  next = updateCommand(next, EVENT_CHEST, [0, 'then', 0], {
    itemId: 'brass_key',
    amount: parseIntField('1', 1),
  });
  // then: setWorldVar
  next = addCommand(next, EVENT_CHEST, [0, 'then', 1], 'setWorldVar');
  next = updateCommand(next, EVENT_CHEST, [0, 'then', 1], {
    key: 'chest_opened',
    value: parseWorldValue('boolean', 'true'),
  });
  // then: showDialogue (textarea → lines)
  next = addCommand(next, EVENT_CHEST, [0, 'then', 2], 'showDialogue');
  next = updateCommand(next, EVENT_CHEST, [0, 'then', 2], {
    source: {
      kind: 'text',
      lines: dialogueLinesFromTextarea('You found a brass key.'),
    },
  });
  // else: showDialogue empty chest
  next = addCommand(next, EVENT_CHEST, [0, 'else', 0], 'showDialogue');
  next = updateCommand(next, EVENT_CHEST, [0, 'else', 0], {
    source: {
      kind: 'text',
      lines: dialogueLinesFromTextarea('The chest is empty.'),
    },
  });
  return next;
}

/** Author a simple greet dialogue + place NPC on it. */
function authorGreet(state: ReturnType<typeof createPainterState>) {
  let next = addEvent(state, EVENT_GREET);
  next = addCommand(next, EVENT_GREET, [0], 'showDialogue');
  next = updateCommand(next, EVENT_GREET, [0], {
    source: {
      kind: 'text',
      lines: dialogueLinesFromTextarea('Welcome!\nStay a while.'),
    },
  });
  return next;
}

function composeFromState(
  doc: ReturnType<typeof createBlankMapDocument>,
  state: ReturnType<typeof createPainterState>,
) {
  return composeDocumentFromPainterFloors(
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
}

describe('exit criterion: events editor form path → saveable map document', () => {
  it('blocks save while a freshly-added giveItem still has empty itemId', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
    });
    state = addEvent(state, 'broken');
    state = addCommand(state, 'broken', [0], 'giveItem');
    // Default giveItem is intentionally incomplete — live validation surfaces it.
    expect(validateEventsDraft(state.events)).toMatch(/Invalid Event Script/);
    expect(canSavePainterDocument(state)).toMatch(/Invalid Event Script/);
  });

  it('authors giveItem + showDialogue + conditional only via form seams, then compose/parse OK', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    // Blank map has empty events — no hand-authored scripts on the document.
    expect(doc.events).toEqual({});

    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
    });

    state = authorChestOpen(state);
    state = authorGreet(state);
    state = setWorldSeed(state, 'chest_opened', parseWorldValue('boolean', 'false'));

    // Intermediate incomplete state is gone; hard-gate open.
    expect(canSavePainterDocument(state)).toBeNull();
    expect(validateEventsDraft(state.events)).toBeNull();

    // Place tools bind to form-authored keys (same as GUI after addEvent).
    state = setActiveNpcSpriteObject(state, SPRITE);
    // greet was added second; place NPC on greet, trigger on chest.
    state = {
      ...state,
      activeNpcEventKey: EVENT_GREET,
      activeTriggerEventKey: EVENT_CHEST,
    };
    state = placeNpc(state, { x: 4, y: 4 });
    state = setActiveTriggerOn(state, 'interact');
    state = placeTrigger(state, { x: 1, y: 1 });

    const composed = composeFromState(doc, state);
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));

    expect(reparsed.events[EVENT_CHEST]).toEqual([
      {
        type: 'conditional',
        if: { key: 'chest_opened', op: 'eq', value: false },
        then: [
          { type: 'giveItem', itemId: 'brass_key', amount: 1 },
          { type: 'setWorldVar', key: 'chest_opened', value: true },
          {
            type: 'showDialogue',
            source: { kind: 'text', lines: ['You found a brass key.'] },
          },
        ],
        else: [
          {
            type: 'showDialogue',
            source: { kind: 'text', lines: ['The chest is empty.'] },
          },
        ],
      },
    ]);
    expect(reparsed.events[EVENT_GREET]).toEqual([
      {
        type: 'showDialogue',
        source: { kind: 'text', lines: ['Welcome!', 'Stay a while.'] },
      },
    ]);
    expect(reparsed.worldSeeds).toEqual({ chest_opened: false });
    expect(reparsed.npcs[0]).toMatchObject({
      x: 4,
      y: 4,
      onInteract: EVENT_GREET,
    });
    expect(reparsed.triggers[0]).toMatchObject({
      x: 1,
      y: 1,
      on: 'interact',
      event: EVENT_CHEST,
    });

    // Same parse the runtime load gate uses for scripts.
    expect(() => parseEventScript({ version: 1, events: reparsed.events })).not.toThrow();
  });
});
