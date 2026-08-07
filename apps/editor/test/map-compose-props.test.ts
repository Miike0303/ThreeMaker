/**
 * C5 WU-04: props join the floor-scoped compose filter used by npcs/triggers.
 */
import type { MapDocument, PropDocument } from '@threemaker/map-format';
import { parseMapDocument, serializeMapDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  type CreateBlankMapDocumentOptions,
  composeDocumentFromPainterFloors,
  createBlankMapDocument,
  painterFloorsFromDocument,
} from '../src/map-compose.js';
import {
  addFloor,
  createPainterState,
  placeProp,
  removeFloor,
  selectFloor,
  setActivePropObject,
} from '../src/painter-store.js';

const BLANK_OPTIONS: CreateBlankMapDocumentOptions = {
  id: 'v5-props-editor',
  name: 'V5 Props Editor',
  width: 4,
  height: 4,
  slots: {},
  flags: new Array(8192).fill(0),
};

const OBJECT_A = 'a'.repeat(64);

const PROP: PropDocument = {
  id: 'prop-1',
  x: 1,
  y: 2,
  floor: 'floor-0',
  object: OBJECT_A,
};

describe('composeDocumentFromPainterFloors: props (C5 WU-04)', () => {
  it('preserves authored props through compose -> serialize -> parse', () => {
    const doc: MapDocument = { ...createBlankMapDocument(BLANK_OPTIONS), props: [PROP] };
    const composed = composeDocumentFromPainterFloors(
      doc,
      painterFloorsFromDocument(doc),
      doc.rooms,
      doc.stairLinks,
      doc.spawn,
      doc.props,
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));
    expect(reparsed.props).toEqual([PROP]);
  });

  it('drops props referencing a floor absent from the composed floors', () => {
    const blank = createBlankMapDocument(BLANK_OPTIONS);
    const ground = blank.floors[0];
    if (!ground) throw new Error('blank always has floors[0]');
    const doc: MapDocument = {
      ...blank,
      floors: [
        ground,
        {
          id: 'floor-1',
          baseElevation: 3,
          layers: ground.layers,
        },
      ],
      props: [PROP, { id: 'prop-2', x: 0, y: 0, floor: 'floor-1', object: OBJECT_A }],
    };

    const floors = painterFloorsFromDocument(doc).filter((f) => f.id !== 'floor-1');
    const composed = composeDocumentFromPainterFloors(
      doc,
      floors,
      doc.rooms,
      doc.stairLinks,
      doc.spawn,
      doc.props,
    );

    expect(composed.props.map((p) => p.id)).toEqual(['prop-1']);
    expect(() => parseMapDocument(JSON.parse(serializeMapDocument(composed)))).not.toThrow();
  });

  it('place on floor-1 then remove floor-1 drops the prop from the composed document', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    let state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
      props: doc.props,
    });
    state = addFloor(state, { id: 'floor-1' });
    state = setActivePropObject(state, OBJECT_A);
    state = placeProp(state, { x: 2, y: 2 });
    expect(state.props[0]?.floor).toBe('floor-1');

    state = selectFloor(state, 0);
    state = removeFloor(state, 1);
    const composed = composeDocumentFromPainterFloors(
      doc,
      state.floors,
      state.rooms,
      state.stairLinks,
      state.spawn,
      state.props,
    );
    expect(composed.props).toEqual([]);
  });
});
