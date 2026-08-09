import { describe, expect, it } from 'vitest';
import {
  propObjectLibrary,
  propsOnFloor,
  roomsOnFloor,
} from '../src/entity-lists.js';

const ROOM_A = {
  id: 'a',
  name: 'Hall',
  floor: 'floor-0',
  rects: [{ x: 0, y: 0, width: 4, height: 4 }],
};
const ROOM_B = {
  id: 'b',
  floor: 'floor-1',
  rects: [{ x: 1, y: 1, width: 2, height: 2 }],
};
const ROOM_C = {
  id: 'c',
  name: 'Cell',
  floor: 'floor-0',
  rects: [{ x: 8, y: 8, width: 3, height: 3 }],
};

const OBJ_A = 'a'.repeat(64);
const OBJ_B = 'b'.repeat(64);
const OBJ_C = 'c'.repeat(64);

const PROP_1 = { id: 'p1', x: 0, y: 0, floor: 'floor-0', object: OBJ_A };
const PROP_2 = { id: 'p2', x: 1, y: 0, floor: 'floor-0', object: OBJ_B };
const PROP_3 = { id: 'p3', x: 0, y: 1, floor: 'floor-1', object: OBJ_A };
const PROP_DUP = { id: 'p4', x: 2, y: 2, floor: 'floor-0', object: OBJ_A };

describe('roomsOnFloor', () => {
  it('filters by floor id and preserves order', () => {
    expect(roomsOnFloor([ROOM_A, ROOM_B, ROOM_C], 'floor-0')).toEqual([ROOM_A, ROOM_C]);
  });

  it('returns empty for unknown floor or undefined id', () => {
    expect(roomsOnFloor([ROOM_A], 'missing')).toEqual([]);
    expect(roomsOnFloor([ROOM_A], undefined)).toEqual([]);
  });
});

describe('propsOnFloor', () => {
  it('filters by floor id and preserves order', () => {
    expect(propsOnFloor([PROP_1, PROP_2, PROP_3], 'floor-0')).toEqual([PROP_1, PROP_2]);
  });

  it('returns empty for unknown floor or undefined id', () => {
    expect(propsOnFloor([PROP_1], 'missing')).toEqual([]);
    expect(propsOnFloor([PROP_1], undefined)).toEqual([]);
  });
});

describe('propObjectLibrary', () => {
  it('lists unique object shas in first-seen placed order', () => {
    expect(propObjectLibrary([PROP_1, PROP_2, PROP_DUP, PROP_3])).toEqual([OBJ_A, OBJ_B]);
  });

  it('puts active object first when not yet placed', () => {
    expect(propObjectLibrary([PROP_1], OBJ_C)).toEqual([OBJ_C, OBJ_A]);
  });

  it('keeps active first even when already placed later', () => {
    expect(propObjectLibrary([PROP_1, PROP_2], OBJ_B)).toEqual([OBJ_B, OBJ_A]);
  });

  it('skips empty and whitespace object strings', () => {
    expect(
      propObjectLibrary([
        { id: 'bad', x: 0, y: 0, floor: 'f', object: '  ' },
        { id: 'ok', x: 0, y: 0, floor: 'f', object: OBJ_A },
      ]),
    ).toEqual([OBJ_A]);
    expect(propObjectLibrary([], '   ')).toEqual([]);
    expect(propObjectLibrary([])).toEqual([]);
  });
});
