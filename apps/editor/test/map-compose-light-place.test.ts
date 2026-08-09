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
  placeLight,
  removeLight,
  setActiveLightColor,
  setActiveLightHeight,
  setActiveLightIntensity,
  setActiveLightKind,
  setActiveLightRange,
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

  it('removeLight drops only active-floor placed light', () => {
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
    // Attached not on floor — remove is no-op by id if floor mismatch; attached has no floor
    state = removeLight(state, 'keep-attached');
    expect(state.lights.map((l) => l.id)).toEqual(['keep-attached']);
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
});
