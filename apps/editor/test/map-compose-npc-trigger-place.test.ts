/**
 * c1a follow-up: place NPC + trigger via painter-store → compose → parseMapDocument
 * round-trip, including live floor filtering of painter-authored entities.
 */
import type { MapDocument } from '@threemaker/map-format';
import { parseMapDocument, serializeMapDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  type CreateBlankMapDocumentOptions,
  composeDocumentFromPainterFloors,
  createBlankMapDocument,
  painterFloorsFromDocument,
} from '../src/map-compose.js';
import {
  createPainterState,
  placeNpc,
  placeTrigger,
  setActiveNpcSpriteObject,
  setActiveTriggerOn,
} from '../src/painter-store.js';

const BLANK_OPTIONS: CreateBlankMapDocumentOptions = {
  id: 'npc-trigger-place',
  name: 'NPC Trigger Place',
  width: 4,
  height: 4,
  slots: {},
  flags: new Array(8192).fill(0),
};

const SPRITE = 'e'.repeat(64);
const EVENT_TALK = 'talk-elder';
const EVENT_GATE = 'open-gate';

function docWithEvents(): MapDocument {
  return {
    ...createBlankMapDocument(BLANK_OPTIONS),
    events: {
      [EVENT_TALK]: [{ type: 'showDialogue', source: { kind: 'ink', storyId: 'elder' } }],
      [EVENT_GATE]: [{ type: 'setWorldVar', key: 'gateOpen', value: true }],
    },
  };
}

describe('composeDocumentFromPainterFloors: placed npcs/triggers (c1a follow-up)', () => {
  it('place NPC + trigger → compose → parseMapDocument OK', () => {
    const doc = docWithEvents();
    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
      eventKeys: Object.keys(doc.events),
      npcs: doc.npcs,
      triggers: doc.triggers,
      props: doc.props,
    });
    state = setActiveNpcSpriteObject(state, SPRITE);
    state = placeNpc(state, { x: 1, y: 1 });
    state = setActiveTriggerOn(state, 'interact');
    state = placeTrigger(state, { x: 2, y: 2 });

    const composed = composeDocumentFromPainterFloors(
      doc,
      state.floors,
      state.rooms,
      state.stairLinks,
      state.spawn,
      state.props,
      state.npcs,
      state.triggers,
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));

    expect(reparsed.npcs).toEqual([
      {
        id: 'npc-1',
        x: 1,
        y: 1,
        floor: 'floor-0',
        facing: 'down',
        sprite: { object: SPRITE, characterIndex: 0 },
        onInteract: EVENT_TALK,
      },
    ]);
    expect(reparsed.triggers).toEqual([
      {
        id: 'trigger-1',
        x: 2,
        y: 2,
        floor: 'floor-0',
        on: 'interact',
        event: EVENT_TALK,
      },
    ]);
    expect(reparsed.events).toEqual(doc.events);
  });

  it('floor-filters live painter npcs/triggers when a floor is removed', () => {
    const base = docWithEvents();
    const doc: MapDocument = {
      ...base,
      floors: [
        ...base.floors,
        {
          id: 'floor-1',
          baseElevation: 1,
          layers: {
            tiles: [
              new Array(16).fill(0),
              new Array(16).fill(0),
              new Array(16).fill(0),
              new Array(16).fill(0),
            ],
            shadows: new Array(16).fill(0),
            regions: new Array(16).fill(0),
          },
        },
      ],
    };

    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
      eventKeys: Object.keys(doc.events),
      activeFloor: 1,
    });
    state = setActiveNpcSpriteObject(state, SPRITE);
    state = placeNpc(state, { x: 1, y: 1 });
    state = placeTrigger(state, { x: 2, y: 2 });
    expect(state.npcs[0]?.floor).toBe('floor-1');
    expect(state.triggers[0]?.floor).toBe('floor-1');

    // Compose with only floor-0 present (simulates removeFloor of floor-1).
    const floor0Only = state.floors.filter((f) => f.id === 'floor-0');
    const composed = composeDocumentFromPainterFloors(
      doc,
      floor0Only,
      state.rooms,
      state.stairLinks,
      state.spawn,
      state.props,
      state.npcs,
      state.triggers,
    );
    expect(composed.npcs).toEqual([]);
    expect(composed.triggers).toEqual([]);
    expect(() => parseMapDocument(JSON.parse(serializeMapDocument(composed)))).not.toThrow();
  });
});
