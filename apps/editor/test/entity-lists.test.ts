import { describe, expect, it } from 'vitest';
import {
  attachedLights,
  clampLightHeight,
  clampLightIntensity,
  clampLightRange,
  entitiesOnFloor,
  entitiesOnKnownFloors,
  LIGHT_HEIGHT_MAX,
  LIGHT_INTENSITY_MAX,
  LIGHT_INTENSITY_MIN,
  LIGHT_RANGE_MAX,
  LIGHT_RANGE_MIN,
  lightAttachTargets,
  lightPlacementFromDocument,
  lightsOnFloor,
  normalizeLightColor,
  npcPlacementFromDocument,
  npcsOnFloor,
  pickMainRoomId,
  propObjectLibrary,
  propPlacementFromDocument,
  propsOnFloor,
  pruneLightsForFloors,
  pruneLightsForNpcs,
  pruneStairLinksForFloors,
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

describe('propPlacementFromDocument', () => {
  it('copies object sha and place transforms for reuse', () => {
    expect(propPlacementFromDocument(PROP_1)).toEqual({
      object: OBJ_A,
      scale: 1,
      rotationY: 0,
      animation: '',
    });
    expect(
      propPlacementFromDocument({
        ...PROP_2,
        scale: 2,
        rotationY: 45,
        animation: 'Spin',
      }),
    ).toEqual({
      object: OBJ_B,
      scale: 2,
      rotationY: 45,
      animation: 'Spin',
    });
  });
});

const LIGHT_PLACED = {
  id: 'lamp-1',
  kind: 'point' as const,
  color: '#ffaa00',
  intensity: 1.5,
  range: 4,
  x: 2,
  y: 3,
  floor: 'floor-0',
  height: 2,
};
const LIGHT_OTHER_FLOOR = {
  id: 'lamp-2',
  kind: 'spot' as const,
  color: '#00ffaa',
  intensity: 1,
  range: 3,
  x: 0,
  y: 0,
  floor: 'floor-1',
};
const LIGHT_ATTACHED = {
  id: 'torch',
  kind: 'point' as const,
  color: '#ff8800',
  intensity: 1,
  range: 3,
  attach: 'player',
};

describe('lightsOnFloor', () => {
  it('returns placed lights on the floor; excludes attached and other floors', () => {
    expect(lightsOnFloor([LIGHT_PLACED, LIGHT_OTHER_FLOOR, LIGHT_ATTACHED], 'floor-0')).toEqual([
      LIGHT_PLACED,
    ]);
    expect(lightsOnFloor([LIGHT_PLACED], undefined)).toEqual([]);
    expect(lightsOnFloor([LIGHT_ATTACHED], 'floor-0')).toEqual([]);
  });
});

describe('clampLightIntensity / range / height (WU-LIGHT-08)', () => {
  it('soft-clamps valid values and rejects non-positive / non-finite', () => {
    expect(clampLightIntensity(1.5)).toBe(1.5);
    expect(clampLightIntensity(0.001)).toBe(LIGHT_INTENSITY_MIN);
    expect(clampLightIntensity(999)).toBe(LIGHT_INTENSITY_MAX);
    expect(clampLightIntensity(0)).toBeUndefined();
    expect(clampLightIntensity(-1)).toBeUndefined();
    expect(clampLightIntensity(Number.NaN)).toBeUndefined();

    expect(clampLightRange(4)).toBe(4);
    expect(clampLightRange(0.001)).toBe(LIGHT_RANGE_MIN);
    expect(clampLightRange(1000)).toBe(LIGHT_RANGE_MAX);
    expect(clampLightRange(0)).toBeUndefined();

    expect(clampLightHeight(0)).toBe(0);
    expect(clampLightHeight(2)).toBe(2);
    expect(clampLightHeight(100)).toBe(LIGHT_HEIGHT_MAX);
    expect(clampLightHeight(-0.1)).toBeUndefined();
  });
});

describe('lightPlacementFromDocument', () => {
  it('copies kind/color/intensity/range and default height 1 when omitted', () => {
    expect(lightPlacementFromDocument(LIGHT_PLACED)).toEqual({
      kind: 'point',
      color: '#ffaa00',
      intensity: 1.5,
      range: 4,
      height: 2,
    });
    expect(lightPlacementFromDocument(LIGHT_OTHER_FLOOR)).toEqual({
      kind: 'spot',
      color: '#00ffaa',
      intensity: 1,
      range: 3,
      height: 1,
    });
    expect(lightPlacementFromDocument(LIGHT_ATTACHED).color).toBe('#ff8800');
  });
});

describe('normalizeLightColor', () => {
  it('lowercases valid #rrggbb and rejects invalid', () => {
    expect(normalizeLightColor('#FFAA00')).toBe('#ffaa00');
    expect(normalizeLightColor('  #00ff00  ')).toBe('#00ff00');
    expect(normalizeLightColor('#fff')).toBeUndefined();
    expect(normalizeLightColor('red')).toBeUndefined();
    expect(normalizeLightColor('#GG0000')).toBeUndefined();
  });
});

describe('attachedLights', () => {
  it('returns only lights with attach; excludes placed', () => {
    expect(attachedLights([LIGHT_PLACED, LIGHT_ATTACHED, LIGHT_OTHER_FLOOR])).toEqual([
      LIGHT_ATTACHED,
    ]);
    expect(attachedLights([LIGHT_PLACED])).toEqual([]);
  });
});

describe('lightAttachTargets', () => {
  it('always includes player then npc ids in document order', () => {
    expect(lightAttachTargets([])).toEqual(['player']);
    expect(lightAttachTargets([NPC_1, NPC_2])).toEqual(['player', 'n1', 'n2']);
  });
});

describe('pruneLightsForNpcs', () => {
  it('keeps player attach, placed lights, and lights on remaining npcs', () => {
    const lights = [
      LIGHT_PLACED,
      LIGHT_ATTACHED,
      {
        id: 'on-n1',
        kind: 'point' as const,
        color: '#00ff00',
        intensity: 1,
        range: 2,
        attach: 'n1',
      },
      {
        id: 'orphan',
        kind: 'point' as const,
        color: '#0000ff',
        intensity: 1,
        range: 2,
        attach: 'missing-npc',
      },
    ];
    expect(pruneLightsForNpcs(lights, [NPC_1]).map((l) => l.id)).toEqual([
      'lamp-1',
      'torch',
      'on-n1',
    ]);
  });

  it('returns same reference when nothing to prune', () => {
    const lights = [LIGHT_PLACED, LIGHT_ATTACHED];
    const next = pruneLightsForNpcs(lights, [NPC_1]);
    expect(next).toEqual(lights);
  });
});

describe('entitiesOnKnownFloors (WU-UTIL-06)', () => {
  it('drops entities on missing floors and keeps same ref when all known', () => {
    const known = new Set(['floor-0']);
    expect(entitiesOnKnownFloors([ROOM_A, ROOM_B, ROOM_C], known)).toEqual([ROOM_A, ROOM_C]);
    const onlyGround = [ROOM_A, ROOM_C];
    expect(entitiesOnKnownFloors(onlyGround, known)).toBe(onlyGround);
  });
});

describe('pruneStairLinksForFloors (WU-UTIL-06)', () => {
  const LINK_OK = {
    id: 's0',
    fromFloor: 'floor-0',
    toFloor: 'floor-1',
    bidirectional: true,
    waypoints: [
      { x: 1, y: 1, floor: 'floor-0' },
      { x: 2, y: 2, floor: 'floor-1' },
    ],
  };
  const LINK_ORPHAN = {
    id: 's1',
    fromFloor: 'floor-0',
    toFloor: 'floor-gone',
    bidirectional: false,
    waypoints: [
      { x: 0, y: 0, floor: 'floor-0' },
      { x: 0, y: 1, floor: 'floor-gone' },
    ],
  };

  it('drops links whose from/to floor is missing', () => {
    const known = new Set(['floor-0', 'floor-1']);
    expect(pruneStairLinksForFloors([LINK_OK, LINK_ORPHAN], known)).toEqual([LINK_OK]);
  });

  it('returns same reference when all links valid', () => {
    const known = new Set(['floor-0', 'floor-1']);
    const links = [LINK_OK];
    expect(pruneStairLinksForFloors(links, known)).toBe(links);
  });
});

describe('pruneLightsForFloors (WU-UTIL-06)', () => {
  it('drops placed lights on missing floors; keeps attached', () => {
    const known = new Set(['floor-0']);
    expect(
      pruneLightsForFloors([LIGHT_PLACED, LIGHT_OTHER_FLOOR, LIGHT_ATTACHED], known).map(
        (l) => l.id,
      ),
    ).toEqual(['lamp-1', 'torch']);
  });

  it('returns same reference when all placed floors known', () => {
    const known = new Set(['floor-0', 'floor-1']);
    const lights = [LIGHT_PLACED, LIGHT_OTHER_FLOOR, LIGHT_ATTACHED];
    expect(pruneLightsForFloors(lights, known)).toBe(lights);
  });
});
