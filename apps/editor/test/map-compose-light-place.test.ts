/**
 * WU-LIGHT-01: place light via painter-store → compose → parseMapDocument
 * round-trip, including floor-filter of live painter lights and attached keep.
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
  nextLightId,
  placeAttachedLight,
  placeLight,
  redoLight,
  removeLight,
  setActiveLightColor,
  setActiveLightHeight,
  setActiveLightIntensity,
  setActiveLightKind,
  setActiveLightRange,
  undoLight,
} from '../src/painter-store.js';

const BLANK_OPTIONS: CreateBlankMapDocumentOptions = {
  id: 'light-place',
  name: 'Light Place',
  width: 4,
  height: 4,
  slots: {},
  flags: new Array(8192).fill(0),
};

describe('nextLightId', () => {
  it('allocates light-1 then skips used ids', () => {
    expect(nextLightId([])).toBe('light-1');
    expect(nextLightId([{ id: 'light-1' } as never, { id: 'light-3' } as never])).toBe('light-2');
  });
});

describe('composeDocumentFromPainterFloors: placed lights (WU-LIGHT-01)', () => {
  it('place light → compose → parseMapDocument OK', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
      lights: doc.lights,
    });
    state = setActiveLightKind(state, 'point');
    state = setActiveLightColor(state, '#FFAA00');
    state = setActiveLightIntensity(state, 1.5);
    state = setActiveLightRange(state, 5);
    state = setActiveLightHeight(state, 2);
    state = placeLight(state, { x: 1, y: 2 });

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
      state.lights,
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));

    expect(reparsed.lights).toEqual([
      {
        id: 'light-1',
        kind: 'point',
        color: '#ffaa00',
        intensity: 1.5,
        range: 5,
        x: 1,
        y: 2,
        floor: 'floor-0',
        height: 2,
      },
    ]);
  });

  it('removeLight drops active-floor placed lights and attached lights', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
      lights: [
        {
          id: 'keep-attached',
          kind: 'point',
          color: '#ff8800',
          intensity: 1,
          range: 3,
          attach: 'player',
        },
        {
          id: 'on-floor',
          kind: 'spot',
          color: '#00ffaa',
          intensity: 1,
          range: 2,
          x: 0,
          y: 0,
          floor: 'floor-0',
        },
      ],
    });
    state = removeLight(state, 'on-floor');
    expect(state.lights.map((l) => l.id)).toEqual(['keep-attached']);
    state = removeLight(state, 'keep-attached');
    expect(state.lights).toEqual([]);
  });

  it('placeAttachedLight → compose → parse; rejects unknown attach targets', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    const withNpc: MapDocument = {
      ...doc,
      npcs: [
        {
          id: 'npc-1',
          x: 0,
          y: 0,
          floor: 'floor-0',
          facing: 'down',
          sprite: { object: 'a'.repeat(64), characterIndex: 0 },
          onInteract: 'talk',
        },
      ],
      events: {
        talk: [{ type: 'showDialogue', source: { kind: 'text', lines: ['hi'] } }],
      },
    };
    let state = createPainterState({
      floors: painterFloorsFromDocument(withNpc),
      width: withNpc.width,
      height: withNpc.height,
      lights: withNpc.lights,
      npcs: withNpc.npcs,
      events: withNpc.events,
    });
    state = setActiveLightColor(state, '#ff8800');
    state = setActiveLightIntensity(state, 1.25);
    state = setActiveLightRange(state, 3);
    expect(placeAttachedLight(state, 'missing-npc')).toBe(state);

    state = placeAttachedLight(state, 'player');
    state = placeAttachedLight(state, 'npc-1');

    const composed = composeDocumentFromPainterFloors(
      withNpc,
      state.floors,
      state.rooms,
      state.stairLinks,
      state.spawn,
      state.props,
      state.npcs,
      state.triggers,
      state.events,
      state.worldSeeds,
      state.lights,
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));
    expect(reparsed.lights).toEqual([
      {
        id: 'light-1',
        kind: 'point',
        color: '#ff8800',
        intensity: 1.25,
        range: 3,
        attach: 'player',
      },
      {
        id: 'light-2',
        kind: 'point',
        color: '#ff8800',
        intensity: 1.25,
        range: 3,
        attach: 'npc-1',
      },
    ]);
  });

  it('floor-filters placed lights; keeps attached lights when a floor is removed', () => {
    const blank = createBlankMapDocument(BLANK_OPTIONS);
    const floor1 = {
      id: 'floor-1',
      baseElevation: 1,
      layers: blank.floors[0]!.layers,
    };
    const doc: MapDocument = {
      ...blank,
      floors: [blank.floors[0]!, floor1],
      lights: [
        {
          id: 'a',
          kind: 'point',
          color: '#ffaa00',
          intensity: 1,
          range: 3,
          x: 1,
          y: 1,
          floor: 'floor-0',
        },
        {
          id: 'b',
          kind: 'point',
          color: '#00aaff',
          intensity: 1,
          range: 3,
          x: 2,
          y: 2,
          floor: 'floor-1',
        },
        {
          id: 'torch',
          kind: 'point',
          color: '#ff8800',
          intensity: 1,
          range: 3,
          attach: 'player',
        },
      ],
    };

    // Compose with only floor-0 in painter floors.
    const floors = painterFloorsFromDocument(doc).filter((f) => f.id === 'floor-0');
    const composed = composeDocumentFromPainterFloors(
      doc,
      floors,
      doc.rooms,
      doc.stairLinks,
      doc.spawn,
      doc.props,
      doc.npcs,
      doc.triggers,
      doc.events,
      doc.worldSeeds,
      doc.lights,
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));
    expect(reparsed.lights.map((l) => l.id).sort()).toEqual(['a', 'torch']);
  });

  it('rejects invalid color on setActiveLightColor (no-op)', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    const state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
    });
    expect(setActiveLightColor(state, 'not-a-color')).toBe(state);
    expect(setActiveLightColor(state, '#ABCDEF').activeLightColor).toBe('#abcdef');
  });

  it('undoLight / redoLight reverse place and remove (WU-LIGHT-05)', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
    });
    state = placeLight(state, { x: 1, y: 1 });
    expect(state.lights).toHaveLength(1);
    ({ state } = undoLight(state));
    expect(state.lights).toEqual([]);
    ({ state } = redoLight(state));
    expect(state.lights).toHaveLength(1);
    const id = state.lights[0]!.id;
    state = removeLight(state, id);
    expect(state.lights).toEqual([]);
    ({ state } = undoLight(state));
    expect(state.lights.map((l) => l.id)).toEqual([id]);
  });

  it('undoLight undoes placeAttachedLight', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
    });
    state = placeAttachedLight(state, 'player');
    expect(state.lights[0]?.attach).toBe('player');
    ({ state } = undoLight(state));
    expect(state.lights).toEqual([]);
  });

  it('compose prunes lights attached to missing NPCs (WU-LIGHT-07)', () => {
    const blank = createBlankMapDocument(BLANK_OPTIONS);
    const doc: MapDocument = {
      ...blank,
      lights: [
        {
          id: 'orphan',
          kind: 'point',
          color: '#00ff00',
          intensity: 1,
          range: 2,
          attach: 'npc-gone',
        },
        {
          id: 'ok',
          kind: 'point',
          color: '#ff8800',
          intensity: 1,
          range: 3,
          attach: 'player',
        },
        {
          id: 'placed',
          kind: 'point',
          color: '#ffaa00',
          intensity: 1,
          range: 4,
          x: 1,
          y: 1,
          floor: 'floor-0',
        },
      ],
    };
    const composed = composeDocumentFromPainterFloors(
      doc,
      painterFloorsFromDocument(doc),
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));
    expect(reparsed.lights.map((l) => l.id).sort()).toEqual(['ok', 'placed']);
  });
});
