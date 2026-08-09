import { describe, expect, it } from 'vitest';
import {
  entitiesOnFloor,
  npcPlacementFromDocument,
  npcsOnFloor,
  pickMainRoomId,
  propObjectLibrary,
  propsOnFloor,
  roomArea,
  roomsOnFloor,
  triggerPlacementFromDocument,
  triggersOnFloor,
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
const ROOM_MULTI = {
  id: 'multi',
  floor: 'floor-0',
  rects: [
    { x: 0, y: 0, width: 2, height: 2 },
    { x: 4, y: 4, width: 5, height: 5 },
  ],
};

const OBJ_A = 'a'.repeat(64);
const OBJ_B = 'b'.repeat(64);
const OBJ_C = 'c'.repeat(64);

const PROP_1 = { id: 'p1', x: 0, y: 0, floor: 'floor-0', object: OBJ_A };
const PROP_2 = { id: 'p2', x: 1, y: 0, floor: 'floor-0', object: OBJ_B };
const PROP_3 = { id: 'p3', x: 0, y: 1, floor: 'floor-1', object: OBJ_A };
const PROP_DUP = { id: 'p4', x: 2, y: 2, floor: 'floor-0', object: OBJ_A };

describe('roomArea', () => {
  it('sums rect areas and ignores negative dimensions as zero', () => {
    expect(roomArea(ROOM_A)).toBe(16);
    expect(roomArea(ROOM_MULTI)).toBe(4 + 25);
    expect(
      roomArea({
        id: 'neg',
        floor: 'f',
        rects: [{ x: 0, y: 0, width: -2, height: 9 }],
      }),
    ).toBe(0);
  });
});

describe('pickMainRoomId', () => {
  it('returns undefined for an empty list', () => {
    expect(pickMainRoomId([])).toBeUndefined();
  });

  it('picks the largest room by area and first on ties', () => {
    // A=16, C=9 → A
    expect(pickMainRoomId([ROOM_A, ROOM_C])).toBe('a');
    // MULTI=29 wins over A=16
    expect(pickMainRoomId([ROOM_A, ROOM_MULTI, ROOM_C])).toBe('multi');
    // equal area: first wins
    const twin = {
      id: 'twin',
      floor: 'floor-0',
      rects: [{ x: 0, y: 0, width: 4, height: 4 }],
    };
    expect(pickMainRoomId([ROOM_A, twin])).toBe('a');
    expect(pickMainRoomId([twin, ROOM_A])).toBe('twin');
  });
});

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

const NPC_1 = {
  id: 'n1',
  x: 1,
  y: 2,
  floor: 'floor-0',
  facing: 'down' as const,
  sprite: { object: OBJ_A, characterIndex: 3 },
  onInteract: 'greet',
};
const NPC_2 = {
  id: 'n2',
  x: 0,
  y: 0,
  floor: 'floor-1',
  facing: 'up' as const,
  sprite: { object: OBJ_B, characterIndex: 0 },
  onInteract: 'shop',
};

const TRIG_1 = {
  id: 't1',
  x: 4,
  y: 5,
  floor: 'floor-0',
  on: 'enter' as const,
  event: 'zone-a',
};
const TRIG_2 = {
  id: 't2',
  x: 0,
  y: 0,
  floor: 'floor-1',
  on: 'interact' as const,
  event: 'chest',
};

describe('entitiesOnFloor / npcsOnFloor / triggersOnFloor', () => {
  it('filters floor-scoped entities', () => {
    expect(entitiesOnFloor([NPC_1, NPC_2], 'floor-0')).toEqual([NPC_1]);
    expect(npcsOnFloor([NPC_1, NPC_2], 'floor-0')).toEqual([NPC_1]);
    expect(triggersOnFloor([TRIG_1, TRIG_2], 'floor-0')).toEqual([TRIG_1]);
    expect(npcsOnFloor([NPC_1], undefined)).toEqual([]);
  });
});

describe('npcPlacementFromDocument', () => {
  it('copies sprite, facing, and onInteract for reuse', () => {
    expect(npcPlacementFromDocument(NPC_1)).toEqual({
      spriteObject: OBJ_A,
      characterIndex: 3,
      facing: 'down',
      eventKey: 'greet',
    });
  });
});

describe('triggerPlacementFromDocument', () => {
  it('copies on and event for reuse', () => {
    expect(triggerPlacementFromDocument(TRIG_1)).toEqual({
      on: 'enter',
      eventKey: 'zone-a',
    });
    expect(triggerPlacementFromDocument(TRIG_2)).toEqual({
      on: 'interact',
      eventKey: 'chest',
    });
  });
});
