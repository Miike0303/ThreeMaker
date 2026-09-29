import { describe, expect, it } from 'vitest';
import { createBlankMapDocument } from '../src/map-compose.js';
import { applyDungeonStampToMapDocument } from '../src/procgen/apply-stamp.js';
import { pickMainRoomSpawn, stampSimpleDungeon } from '../src/procgen/dungeon-stamp.js';

function twoFloorSemanticFixture(
  currentClass: 'window' | 'wall' | 'none',
  floor0TileId: number,
  floor1TileId: number,
) {
  const blank = createBlankMapDocument({
    id: 'stamp-cross-floor-semantic',
    name: 'Cross-floor semantics',
    width: 16,
    height: 16,
    slots: {},
    flags: new Array(8192).fill(0),
  });
  const ground = blank.floors[0];
  if (!ground) throw new Error('fixture has no ground floor');
  const floor0Tiles = structuredClone(ground.layers.tiles) as [
    number[],
    number[],
    number[],
    number[],
  ];
  const floor1Tiles = structuredClone(ground.layers.tiles) as [
    number[],
    number[],
    number[],
    number[],
  ];
  floor0Tiles[0][0] = floor0TileId;
  floor1Tiles[3][1] = floor1TileId;
  const doc = {
    ...blank,
    floors: [
      { ...ground, layers: { ...ground.layers, tiles: floor0Tiles } },
      {
        ...ground,
        id: 'floor-1',
        baseElevation: 1,
        layers: { ...ground.layers, tiles: floor1Tiles },
      },
    ],
    tileset: {
      ...blank.tileset,
      semantics: { '4352': { class: currentClass } },
    },
  };
  const stamp = stampSimpleDungeon({
    width: 16,
    height: 16,
    seed: 3,
    groundTileId: 2816,
    wallTileId: 4352,
  });
  return { doc, stamp };
}

function rectangularStairFixture(roomCount: number) {
  const blank = createBlankMapDocument({
    id: 'stamp-rectangular-stairs',
    name: 'Rectangular stairs',
    width: 20,
    height: 12,
    slots: {},
    flags: new Array(8192).fill(0),
  });
  const ground = blank.floors[0];
  if (!ground) throw new Error('fixture has no ground floor');
  const doc = {
    ...blank,
    floors: [ground, { ...ground, id: 'floor-1', baseElevation: 1 }],
  };
  const stamp = stampSimpleDungeon({
    width: doc.width,
    height: doc.height,
    seed: 3,
    groundTileId: 2816,
    wallTileId: 4352,
    roomCount,
  });
  return { doc, stamp };
}

describe('applyDungeonStampToMapDocument', () => {
  it('reports a fractional target floor as an out-of-range index', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 0);

    expect(() => applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 0.5 })).toThrow(
      'target floor index 0.5 is out of range (floors=2)',
    );
  });

  it('classifies furniture in the first mid-layer cell', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 0);
    stamp.layers[1][0] = 9001;

    const next = applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 1 });

    expect(next.floors[1]?.layers.tiles[1][0]).toBe(9001);
    expect(next.tileset.semantics['9001']).toEqual({ class: 'furniture' });
  });

  it('uses the rectangular map center for a stair entry when no rooms were stamped', () => {
    const { doc, stamp } = rectangularStairFixture(0);

    const next = applyDungeonStampToMapDocument(doc, stamp, {
      targetFloorIndex: 1,
      placeStairToAdjacentFloor: true,
    });

    expect(next.stairLinks[0]?.waypoints[0]).toEqual({ x: 10, y: 6, floor: 'floor-1' });
  });

  it('lands stairs at the rectangular map center when the adjacent floor has no rooms', () => {
    const { doc, stamp } = rectangularStairFixture(1);

    const next = applyDungeonStampToMapDocument(doc, stamp, {
      targetFloorIndex: 0,
      placeStairToAdjacentFloor: true,
    });

    expect(next.stairLinks[0]?.waypoints[1]).toEqual({ x: 10, y: 6, floor: 'floor-1' });
  });

  it('rejects wall stamping that would reclass a door tile used on another floor', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 4352, 0);
    const sharedDoorDoc = {
      ...doc,
      tileset: {
        ...doc.tileset,
        semantics: { '4352': { class: 'door' as const } },
      },
    };

    expect(() =>
      applyDungeonStampToMapDocument(sharedDoorDoc, stamp, { targetFloorIndex: 1 }),
    ).toThrow(/tile 4352.*door.*wall.*floor-0/);
  });

  it('drops a negative stair column even when its wrapped cell is standable', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 0);
    const wrappedIndex = doc.width - 1;
    stamp.layers[0][wrappedIndex] = 2816;
    stamp.layers[2][wrappedIndex] = 0;
    const stair = {
      id: 'authored-negative-column',
      fromFloor: 'floor-1',
      toFloor: 'floor-0',
      bidirectional: true,
      waypoints: [
        { x: -1, y: 1, floor: 'floor-1' },
        { x: 1, y: 1, floor: 'floor-0' },
      ],
    };

    const next = applyDungeonStampToMapDocument({ ...doc, stairLinks: [stair] }, stamp, {
      targetFloorIndex: 1,
      placeStairToAdjacentFloor: true,
    });

    expect(next.stairLinks.map((link) => link.id)).not.toContain(stair.id);
  });

  it('keeps an authored stair on standable row zero after stamping', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 0);
    stamp.layers[0][1] = 2816;
    stamp.layers[2][1] = 0;
    const stair = {
      id: 'authored-first-row',
      fromFloor: 'floor-1',
      toFloor: 'floor-0',
      bidirectional: true,
      waypoints: [
        { x: 1, y: 0, floor: 'floor-1' },
        { x: 1, y: 1, floor: 'floor-0' },
      ],
    };

    const next = applyDungeonStampToMapDocument({ ...doc, stairLinks: [stair] }, stamp, {
      targetFloorIndex: 1,
      placeStairToAdjacentFloor: true,
    });

    expect(next.stairLinks).toContainEqual(stair);
  });

  it('rejects a NaN target floor instead of defaulting to the ground floor', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 0);

    expect(() =>
      applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: Number.NaN }),
    ).toThrow(/target floor index/);
  });

  it('keeps an authored stair on standable column zero after stamping', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 0);
    stamp.layers[0][doc.width] = 2816;
    stamp.layers[2][doc.width] = 0;
    const stair = {
      id: 'authored-first-column',
      fromFloor: 'floor-1',
      toFloor: 'floor-0',
      bidirectional: true,
      waypoints: [
        { x: 0, y: 1, floor: 'floor-1' },
        { x: 1, y: 1, floor: 'floor-0' },
      ],
    };

    const next = applyDungeonStampToMapDocument({ ...doc, stairLinks: [stair] }, stamp, {
      targetFloorIndex: 1,
      placeStairToAdjacentFloor: true,
    });

    expect(next.stairLinks).toContainEqual(stair);
  });

  it('copies stamped furniture into the target floor mid layer', () => {
    const { doc } = twoFloorSemanticFixture('none', 0, 0);
    const stamp = stampSimpleDungeon({
      width: doc.width,
      height: doc.height,
      seed: 42,
      groundTileId: 2816,
      wallTileId: 4352,
      furnitureTileId: 9001,
      furnitureDensity: 1,
      roomCount: 1,
    });
    const expectedMid = stamp.layers[1].slice();
    expect(stamp.furnitureCount).toBeGreaterThan(0);

    const next = applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 1 });

    expect(next.floors[1]?.layers.tiles[1]).toEqual(expectedMid);
  });

  it('clears the over layer without copying stamped furniture into it', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 9001);
    stamp.layers[1][0] = 9001;

    const next = applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 1 });

    expect(next.floors[1]?.layers.tiles[3]).toEqual(new Array(doc.width * doc.height).fill(0));
  });

  it('applies player torch options independently of room light options', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 0);
    const playerTorchOptions = {
      id: 'explorer-torch',
      kind: 'spot' as const,
      color: '#123456',
      intensity: 0,
      range: 7,
    };

    const next = applyDungeonStampToMapDocument(doc, stamp, {
      placeRoomLights: true,
      roomLightOptions: { kind: 'point', color: '#abcdef', intensity: 2, range: 4 },
      placePlayerTorch: true,
      playerTorchOptions,
    });

    expect(next.lights.find((light) => light.attach === 'player')).toEqual({
      ...playerTorchOptions,
      attach: 'player',
    });
  });

  it('drops a fractional stair row even when its linear index is standable', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 0);
    stamp.layers[0][1] = 2816;
    stamp.layers[2][1] = 0;
    const stair = {
      id: 'authored-fractional-row',
      fromFloor: 'floor-1',
      toFloor: 'floor-0',
      bidirectional: true,
      waypoints: [
        { x: 0, y: 1 / doc.width, floor: 'floor-1' },
        { x: 1, y: 1, floor: 'floor-0' },
      ],
    };

    const next = applyDungeonStampToMapDocument({ ...doc, stairLinks: [stair] }, stamp, {
      targetFloorIndex: 1,
      placeStairToAdjacentFloor: true,
    });

    expect(next.stairLinks.map((link) => link.id)).not.toContain(stair.id);
  });

  it('rejects door stamping that would reclass a wall tile used on another floor', () => {
    const { doc } = twoFloorSemanticFixture('wall', 5001, 0);
    const sharedWallDoc = {
      ...doc,
      tileset: {
        ...doc.tileset,
        semantics: { ...doc.tileset.semantics, '5001': { class: 'wall' as const } },
      },
    };
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 42,
      groundTileId: 2816,
      wallTileId: 4352,
      doorTileId: 5001,
      minRoomSize: 3,
      maxRoomSize: 3,
      roomCount: 2,
    });

    expect(stamp.doors.length).toBeGreaterThan(0);
    expect(() =>
      applyDungeonStampToMapDocument(sharedWallDoc, stamp, { targetFloorIndex: 1 }),
    ).toThrow(/tile 5001.*wall.*door.*floor-0/);
  });

  it('rejects furniture stamping that would reclass a wall tile used on another floor', () => {
    const { doc } = twoFloorSemanticFixture('wall', 9001, 0);
    const sharedWallDoc = {
      ...doc,
      tileset: {
        ...doc.tileset,
        semantics: { ...doc.tileset.semantics, '9001': { class: 'wall' as const } },
      },
    };
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 42,
      groundTileId: 2816,
      wallTileId: 4352,
      furnitureTileId: 9001,
      furnitureDensity: 1,
      minRoomSize: 4,
      maxRoomSize: 4,
      roomCount: 1,
    });

    expect(stamp.furnitureCount).toBeGreaterThan(0);
    expect(() =>
      applyDungeonStampToMapDocument(sharedWallDoc, stamp, { targetFloorIndex: 1 }),
    ).toThrow(/tile 9001.*wall.*furniture.*floor-0/);
  });

  it('drops an east-edge stair waypoint even when its wrapped cell is standable', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 0, 0);
    const wrappedIndex = 2 * doc.width;
    stamp.layers[0][wrappedIndex] = 2816;
    stamp.layers[2][wrappedIndex] = 0;
    const stair = {
      id: 'authored-east-edge',
      fromFloor: 'floor-1',
      toFloor: 'floor-0',
      bidirectional: true,
      waypoints: [
        { x: doc.width, y: 1, floor: 'floor-1' },
        { x: 1, y: 1, floor: 'floor-0' },
      ],
    };

    const next = applyDungeonStampToMapDocument({ ...doc, stairLinks: [stair] }, stamp, {
      targetFloorIndex: 1,
      placeStairToAdjacentFloor: true,
    });

    expect(next.stairLinks.map((link) => link.id)).not.toContain(stair.id);
  });

  it('uses the requested room-light ID prefix when applying a stamp', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-light-prefix',
      name: 'Light prefix',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 1,
      groundTileId: 2816,
      wallTileId: 4352,
      roomCount: 1,
    });

    const next = applyDungeonStampToMapDocument(doc, stamp, {
      placeRoomLights: true,
      roomLightOptions: { idPrefix: 'custom-lamp' },
    });

    expect(next.lights.map((light) => light.id)).toEqual(['custom-lamp-1']);
  });

  it('throws when the last stamp layer is larger than the map', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-long-layer',
      name: 'Long layer',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 1,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    stamp.layers[3].push(0);

    expect(() => applyDungeonStampToMapDocument(doc, stamp)).toThrow(/stamp layer length/);
  });

  it('throws when a stamp layer is smaller than the map', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-short-layer',
      name: 'Short layer',
      width: 17,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 1,
      groundTileId: 2816,
      wallTileId: 4352,
    });

    expect(() => applyDungeonStampToMapDocument(doc, stamp)).toThrow(/stamp layer length/);
  });

  it('writes stamp layers onto floor 0 without changing map size', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-apply',
      name: 'Stamp',
      width: 20,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 20,
      height: 16,
      seed: 99,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp);
    expect(next.width).toBe(20);
    expect(next.height).toBe(16);
    expect(next.floors[0]?.layers.tiles[0]).toEqual(stamp.layers[0]);
    expect(next.floors[0]?.layers.tiles[2]).toEqual(stamp.layers[2]);
  });

  it('preserves events, npcs, spawn, and worldSeeds on the document', () => {
    const base = createBlankMapDocument({
      id: 'stamp-keep',
      name: 'Keep',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const doc = {
      ...base,
      spawn: { x: 2, y: 2, floor: 'floor-0' },
      events: {
        talk: [{ type: 'showDialogue' as const, source: { kind: 'text' as const, lines: ['hi'] } }],
      },
      worldSeeds: { flag: true },
      npcs: [
        {
          id: 'npc-1',
          x: 3,
          y: 3,
          floor: 'floor-0',
          facing: 'down' as const,
          sprite: { object: 'c'.repeat(64), characterIndex: 0 },
          onInteract: 'talk',
        },
      ],
    };
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 1,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp);
    expect(next.events).toEqual(doc.events);
    expect(next.npcs).toEqual(doc.npcs);
    expect(next.spawn).toEqual(doc.spawn);
    expect(next.worldSeeds).toEqual(doc.worldSeeds);
  });

  it('places spawn in the main room when requested', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-spawn',
      name: 'Spawn',
      width: 24,
      height: 18,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stampedDoc = {
      ...doc,
      spawn: { x: 0, y: 0, floor: 'floor-0' },
    };
    const stamp = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 42,
      groundTileId: 2816,
      wallTileId: 4352,
      roomCount: 6,
    });
    const next = applyDungeonStampToMapDocument(stampedDoc, stamp, {
      placeSpawnInMainRoom: true,
    });
    const expected = pickMainRoomSpawn(stamp.rooms, 24, 18);
    expect(next.spawn).toEqual({
      x: expected.x,
      y: expected.y,
      floor: 'floor-0',
    });
    // Still walkable under the new spawn.
    const i = expected.y * 24 + expected.x;
    expect(next.floors[0]?.layers.tiles[0]?.[i]).toBe(2816);
    expect(next.floors[0]?.layers.tiles[2]?.[i]).toBe(0);
  });

  it('tags stamped wall tile ids with semantic class wall and preserves other semantics', () => {
    const base = createBlankMapDocument({
      id: 'stamp-sem',
      name: 'Sem',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const doc = {
      ...base,
      tileset: {
        ...base.tileset,
        semantics: {
          '99': { class: 'furniture' as const },
          '4352': { class: 'door' as const },
        },
      },
    };
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 3,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp);
    expect(next.tileset.semantics['4352']).toEqual({ class: 'wall' });
    expect(next.tileset.semantics['99']).toEqual({ class: 'furniture' });
    // Ground id is not forced to wall.
    expect(next.tileset.semantics['2816']).toBeUndefined();
  });

  it('rejects reclassing a tile used on another floor without mutating the document', () => {
    const { doc, stamp } = twoFloorSemanticFixture('window', 4352, 0);
    const before = structuredClone(doc);

    expect(() => applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 1 })).toThrow(
      /tile 4352.*window.*wall.*floor-0/,
    );
    expect(doc).toEqual(before);
  });

  it('reclasses a tile used only on the target floor', () => {
    const { doc, stamp } = twoFloorSemanticFixture('window', 0, 4352);

    const next = applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 1 });

    expect(next.tileset.semantics['4352']).toEqual({ class: 'wall' });
    expect(next.floors[1]?.layers.tiles[2]).toEqual(stamp.layers[2]);
  });

  it('classifies a shared tile whose existing semantic class is none', () => {
    const { doc, stamp } = twoFloorSemanticFixture('none', 4352, 0);

    const next = applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 1 });

    expect(next.tileset.semantics['4352']).toEqual({ class: 'wall' });
    expect(next.floors[0]?.layers.tiles[0]?.[0]).toBe(4352);
    expect(doc.tileset.semantics['4352']).toEqual({ class: 'none' });
  });

  it('stamps a tile used on another floor with the same semantic class', () => {
    const { doc, stamp } = twoFloorSemanticFixture('wall', 4352, 0);

    const next = applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 1 });

    expect(next.tileset.semantics['4352']).toEqual({ class: 'wall' });
    expect(next.floors[0]?.layers.tiles[0]?.[0]).toBe(4352);
    expect(next.floors[1]?.layers.tiles[2]).toEqual(stamp.layers[2]);
  });

  it('tags stamped mid-layer door tiles with semantic class door', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-door',
      name: 'Door',
      width: 32,
      height: 24,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: 2816,
      wallTileId: 4352,
      doorTileId: 5001,
      roomCount: 5,
    });
    expect(stamp.doors.length).toBeGreaterThan(0);
    const next = applyDungeonStampToMapDocument(doc, stamp);
    expect(next.tileset.semantics['5001']).toEqual({ class: 'door' });
    expect(next.tileset.semantics['4352']).toEqual({ class: 'wall' });
  });

  it('tags mid furniture tiles as furniture without reclassing doors', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-furn',
      name: 'Furn',
      width: 32,
      height: 24,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: 2816,
      wallTileId: 4352,
      doorTileId: 5001,
      furnitureTileId: 9001,
      furnitureDensity: 0.4,
      roomCount: 5,
    });
    expect(stamp.furnitureCount).toBeGreaterThan(0);
    const next = applyDungeonStampToMapDocument(doc, stamp);
    expect(next.tileset.semantics['5001']).toEqual({ class: 'door' });
    expect(next.tileset.semantics['9001']).toEqual({ class: 'furniture' });
  });

  it('applies roomLightOptions color when placing lights', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-mood',
      name: 'Mood',
      width: 20,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 20,
      height: 16,
      seed: 3,
      groundTileId: 2816,
      wallTileId: 4352,
      roomCount: 3,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp, {
      placeRoomLights: true,
      roomLightOptions: { color: '#88ccff', intensity: 0.85, range: 4, height: 1.5 },
    });
    const roomLights = next.lights.filter((l) => l.floor === 'floor-0');
    expect(roomLights.length).toBe(stamp.rooms.length);
    expect(roomLights.every((l) => l.color === '#88ccff')).toBe(true);
    expect(roomLights.every((l) => l.intensity === 0.85)).toBe(true);
  });

  it('places room-center lights when placeRoomLights is true', () => {
    const base = createBlankMapDocument({
      id: 'stamp-lights',
      name: 'Lights',
      width: 24,
      height: 18,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const doc = {
      ...base,
      lights: [
        {
          id: 'old-floor',
          kind: 'point' as const,
          color: '#ffffff',
          intensity: 1,
          range: 2,
          x: 0,
          y: 0,
          floor: 'floor-0',
        },
        {
          id: 'torch',
          kind: 'point' as const,
          color: '#ff8800',
          intensity: 1,
          range: 3,
          attach: 'player',
        },
      ],
    };
    const stamp = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 7,
      groundTileId: 2816,
      wallTileId: 4352,
      roomCount: 4,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp, { placeRoomLights: true });
    expect(next.lights.some((l) => l.id === 'torch')).toBe(true);
    expect(next.lights.some((l) => l.id === 'old-floor')).toBe(false);
    const roomLights = next.lights.filter((l) => l.floor === 'floor-0');
    expect(roomLights).toHaveLength(stamp.rooms.length);
    expect(roomLights.every((l) => l.id.startsWith('stamp-light-'))).toBe(true);
  });

  it('does not invent lights when placeRoomLights is omitted', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-no-lights',
      name: 'NoLights',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 1,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp);
    expect(next.lights).toEqual([]);
  });

  it('places player torch when placePlayerTorch is true', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-torch',
      name: 'Torch',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 2,
      groundTileId: 2816,
      wallTileId: 4352,
      roomCount: 2,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp, {
      placeRoomLights: true,
      placePlayerTorch: true,
    });
    const torch = next.lights.find((l) => l.attach === 'player');
    expect(torch).toMatchObject({
      id: 'player-torch',
      attach: 'player',
      color: '#ff8800',
    });
    expect(next.lights.filter((l) => l.floor === 'floor-0')).toHaveLength(stamp.rooms.length);
  });

  it('stamps tiles/rooms/lights/spawn onto targetFloorIndex and leaves other floors', () => {
    const blank = createBlankMapDocument({
      id: 'stamp-floor1',
      name: 'Floor1',
      width: 20,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const ground = blank.floors[0];
    if (!ground) throw new Error('fixture has no ground floor');
    const size = blank.width * blank.height;
    // Marker tile on floor-0 so we can prove it survives stamping floor-1.
    const floor0Tiles = ground.layers.tiles.map((layer, li) => {
      const copy = layer.slice();
      if (li === 0) copy[0] = 1111;
      return copy;
    }) as [number[], number[], number[], number[]];
    const floor1 = {
      id: 'floor-1',
      baseElevation: 1,
      layers: {
        tiles: [
          new Array(size).fill(0),
          new Array(size).fill(0),
          new Array(size).fill(0),
          new Array(size).fill(0),
        ] as [number[], number[], number[], number[]],
        shadows: new Array(size).fill(0),
        regions: new Array(size).fill(0),
      },
    };
    const doc = {
      ...blank,
      floors: [{ ...ground, layers: { ...ground.layers, tiles: floor0Tiles } }, floor1],
      rooms: [
        {
          id: 'keep-0',
          floor: 'floor-0',
          rects: [{ x: 0, y: 0, width: 2, height: 2 }],
        },
        {
          id: 'old-1',
          floor: 'floor-1',
          rects: [{ x: 1, y: 1, width: 2, height: 2 }],
        },
      ],
      lights: [
        {
          id: 'floor0-lamp',
          kind: 'point' as const,
          color: '#ffffff',
          intensity: 1,
          range: 2,
          x: 0,
          y: 0,
          floor: 'floor-0',
        },
      ],
      spawn: { x: 0, y: 0, floor: 'floor-0' },
    };
    const stamp = stampSimpleDungeon({
      width: 20,
      height: 16,
      seed: 5,
      groundTileId: 2816,
      wallTileId: 4352,
      roomCount: 3,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp, {
      targetFloorIndex: 1,
      placeSpawnInMainRoom: true,
      replaceFloor0Rooms: true,
      placeRoomLights: true,
    });

    // Floor 0 tiles + rooms + lights untouched.
    expect(next.floors[0]?.layers.tiles[0]?.[0]).toBe(1111);
    expect(next.rooms.find((r) => r.id === 'keep-0')).toEqual(doc.rooms[0]);
    expect(next.lights.some((l) => l.id === 'floor0-lamp')).toBe(true);

    // Floor 1 receives stamp layers.
    expect(next.floors[1]?.layers.tiles[0]).toEqual(stamp.layers[0]);
    expect(next.floors[1]?.layers.tiles[2]).toEqual(stamp.layers[2]);

    // Rooms replaced only on floor-1.
    expect(next.rooms.some((r) => r.id === 'old-1')).toBe(false);
    const floor1Rooms = next.rooms.filter((r) => r.floor === 'floor-1');
    expect(floor1Rooms).toHaveLength(stamp.rooms.length);
    expect(floor1Rooms.every((r) => r.id.startsWith('procgen-room-'))).toBe(true);

    // Spawn + lights on floor-1; light ids stay unique vs floor-0 stamps.
    const expected = pickMainRoomSpawn(stamp.rooms, 20, 16);
    expect(next.spawn).toEqual({ x: expected.x, y: expected.y, floor: 'floor-1' });
    const floor1Lights = next.lights.filter((l) => l.floor === 'floor-1');
    expect(floor1Lights).toHaveLength(stamp.rooms.length);
    expect(floor1Lights.every((l) => l.id.includes('floor-1'))).toBe(true);
    const lightIds = next.lights.map((l) => l.id);
    expect(new Set(lightIds).size).toBe(lightIds.length);
  });

  it('throws when targetFloorIndex is out of range', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-oob-floor',
      name: 'Oob',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 1,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    expect(() => applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 1 })).toThrow(
      /target floor/i,
    );
  });

  it('drops an authored stair whose stamped-floor waypoint has ground beneath a wall', () => {
    const blank = createBlankMapDocument({
      id: 'stamp-wall-stair',
      name: 'Wall stair',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const floor0 = blank.floors[0];
    if (!floor0) throw new Error('fixture has no ground floor');
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 9,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    const wallIndex = stamp.layers[0].findIndex(
      (ground, index) => ground !== 0 && stamp.layers[2][index] !== 0,
    );
    if (wallIndex < 0) throw new Error('fixture has no ground-backed wall');
    const wallWaypoint = {
      x: wallIndex % blank.width,
      y: Math.floor(wallIndex / blank.width),
      floor: 'floor-1',
    };
    const doc = {
      ...blank,
      floors: [floor0, { ...floor0, id: 'floor-1', baseElevation: 1 }],
      stairLinks: [
        {
          id: 'authored-wall-stair',
          fromFloor: 'floor-1',
          toFloor: 'floor-0',
          bidirectional: true,
          waypoints: [wallWaypoint, { x: 1, y: 1, floor: 'floor-0' }],
        },
      ],
    };

    const next = applyDungeonStampToMapDocument(doc, stamp, {
      targetFloorIndex: 1,
      placeStairToAdjacentFloor: true,
    });

    expect(next.floors[1]?.layers.tiles[0][wallIndex]).toBe(2816);
    expect(next.floors[1]?.layers.tiles[2][wallIndex]).toBe(4352);
    expect(next.stairLinks.some((link) => link.id === 'authored-wall-stair')).toBe(false);
  });

  it('places a stair to the adjacent floor when multi-floor and requested', () => {
    const blank = createBlankMapDocument({
      id: 'stamp-stair',
      name: 'Stair',
      width: 20,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const size = blank.width * blank.height;
    const ground = blank.floors[0];
    if (!ground) throw new Error('fixture has no ground floor');
    const floor1 = {
      id: 'floor-1',
      baseElevation: 1,
      layers: {
        tiles: [
          new Array(size).fill(0),
          new Array(size).fill(0),
          new Array(size).fill(0),
          new Array(size).fill(0),
        ] as [number[], number[], number[], number[]],
        shadows: new Array(size).fill(0),
        regions: new Array(size).fill(0),
      },
    };
    const stamp = stampSimpleDungeon({
      width: 20,
      height: 16,
      seed: 9,
      groundTileId: 2816,
      wallTileId: 4352,
      roomCount: 3,
    });
    const room = stamp.rooms[0];
    if (!room) throw new Error('fixture has no stamped room');
    const roomCell = { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
    const roomIndex = roomCell.y * blank.width + roomCell.x;
    expect(stamp.layers[0][roomIndex]).not.toBe(0);
    expect(stamp.layers[2][roomIndex]).toBe(0);
    const blockedIndex = stamp.layers[0].findIndex(
      (ground, index) => ground === 0 || stamp.layers[2][index] !== 0,
    );
    if (blockedIndex < 0) throw new Error('fixture has no blocked stamped cell');
    const blockedCell = {
      x: blockedIndex % blank.width,
      y: Math.floor(blockedIndex / blank.width),
    };
    const doc = {
      ...blank,
      floors: [ground, floor1],
      rooms: [
        {
          id: 'ground-hall',
          floor: 'floor-0',
          rects: [{ x: 2, y: 2, width: 6, height: 6 }],
        },
      ],
      stairLinks: [
        {
          id: 'authored-other',
          fromFloor: 'floor-0',
          toFloor: 'floor-1',
          bidirectional: true,
          waypoints: [
            { x: 0, y: 0, floor: 'floor-0' },
            { ...roomCell, floor: 'floor-1' },
          ],
        },
        {
          id: 'authored-blocked',
          fromFloor: 'floor-1',
          toFloor: 'floor-0',
          bidirectional: true,
          waypoints: [
            { ...blockedCell, floor: 'floor-1' },
            { x: 1, y: 1, floor: 'floor-0' },
          ],
        },
        {
          id: 'keep-far',
          fromFloor: 'floor-1',
          toFloor: 'floor-ghost',
          bidirectional: false,
          waypoints: [
            { x: 0, y: 0, floor: 'floor-1' },
            { x: 0, y: 1, floor: 'floor-ghost' },
          ],
        },
      ],
    };
    const next = applyDungeonStampToMapDocument(doc, stamp, {
      targetFloorIndex: 1,
      replaceFloor0Rooms: true,
      placeStairToAdjacentFloor: true,
    });
    const stampStairs = next.stairLinks.filter((l) => l.id.startsWith('stamp-stair-'));
    expect(stampStairs).toHaveLength(1);
    expect(stampStairs[0]?.fromFloor).toBe('floor-1');
    expect(stampStairs[0]?.toFloor).toBe('floor-0');
    expect(stampStairs[0]?.bidirectional).toBe(true);
    // Standable authored stair and unrelated pair stay; blocked authored stair is removed.
    expect(next.stairLinks.some((l) => l.id === 'authored-other')).toBe(true);
    expect(next.stairLinks.some((l) => l.id === 'authored-blocked')).toBe(false);
    expect(next.stairLinks.some((l) => l.id === 'keep-far')).toBe(true);
  });

  it('does not invent stairs when placeStairToAdjacentFloor is omitted', () => {
    const blank = createBlankMapDocument({
      id: 'stamp-no-stair',
      name: 'NoStair',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const size = blank.width * blank.height;
    const ground = blank.floors[0];
    if (!ground) throw new Error('fixture has no ground floor');
    const doc = {
      ...blank,
      floors: [
        ground,
        {
          id: 'floor-1',
          baseElevation: 1,
          layers: {
            tiles: [
              new Array(size).fill(0),
              new Array(size).fill(0),
              new Array(size).fill(0),
              new Array(size).fill(0),
            ] as [number[], number[], number[], number[]],
            shadows: new Array(size).fill(0),
            regions: new Array(size).fill(0),
          },
        },
      ],
    };
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 2,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp, { targetFloorIndex: 1 });
    expect(next.stairLinks).toEqual([]);
  });
});
