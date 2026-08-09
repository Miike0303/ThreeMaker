import { describe, expect, it } from 'vitest';
import { createBlankMapDocument } from '../src/map-compose.js';
import { applyDungeonStampToMapDocument } from '../src/procgen/apply-stamp.js';
import { pickMainRoomSpawn, stampSimpleDungeon } from '../src/procgen/dungeon-stamp.js';

describe('applyDungeonStampToMapDocument', () => {
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
});
