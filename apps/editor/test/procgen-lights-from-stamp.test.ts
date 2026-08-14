import type { LightDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  dungeonRoomCenter,
  ensurePlayerTorch,
  lightsFromDungeonRooms,
  mergeStampRoomLights,
  playerTorchLight,
} from '../src/procgen/lights-from-stamp.js';

describe('dungeonRoomCenter', () => {
  it('returns integer center of the room rect', () => {
    expect(dungeonRoomCenter({ x: 2, y: 4, w: 5, h: 3 })).toEqual({ x: 4, y: 5 });
    expect(dungeonRoomCenter({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0 });
  });
});

describe('lightsFromDungeonRooms', () => {
  it('returns empty for no rooms', () => {
    expect(lightsFromDungeonRooms([], 'floor-0')).toEqual([]);
  });

  it('places one light per room at center with stable ids', () => {
    const lights = lightsFromDungeonRooms(
      [
        { x: 0, y: 0, w: 4, h: 4 },
        { x: 10, y: 10, w: 3, h: 5 },
      ],
      'floor-0',
    );
    expect(lights).toEqual([
      {
        id: 'stamp-light-1',
        kind: 'point',
        color: '#ffaa00',
        intensity: 1.2,
        range: 5,
        x: 2,
        y: 2,
        floor: 'floor-0',
        height: 2,
      },
      {
        id: 'stamp-light-2',
        kind: 'point',
        color: '#ffaa00',
        intensity: 1.2,
        range: 5,
        x: 11,
        y: 12,
        floor: 'floor-0',
        height: 2,
      },
    ]);
  });

  it('honors brush overrides', () => {
    const [light] = lightsFromDungeonRooms([{ x: 0, y: 0, w: 2, h: 2 }], 'f1', {
      kind: 'spot',
      color: '#00aaff',
      intensity: 2,
      range: 8,
      height: 3,
      idPrefix: 'lamp',
    });
    expect(light).toMatchObject({
      id: 'lamp-1',
      kind: 'spot',
      color: '#00aaff',
      intensity: 2,
      range: 8,
      height: 3,
      floor: 'f1',
    });
  });
});

describe('mergeStampRoomLights', () => {
  it('replaces placed lights on the floor; keeps attached and other floors', () => {
    const existing: LightDocument[] = [
      {
        id: 'old-floor',
        kind: 'point',
        color: '#ffffff',
        intensity: 1,
        range: 2,
        x: 0,
        y: 0,
        floor: 'floor-0',
      },
      {
        id: 'other',
        kind: 'point',
        color: '#ffffff',
        intensity: 1,
        range: 2,
        x: 1,
        y: 1,
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
    ];
    const stamp = lightsFromDungeonRooms([{ x: 2, y: 2, w: 2, h: 2 }], 'floor-0');
    const merged = mergeStampRoomLights(existing, 'floor-0', stamp);
    expect(merged.map((l) => l.id)).toEqual(['other', 'torch', 'stamp-light-1']);
  });
});

describe('playerTorchLight / ensurePlayerTorch', () => {
  it('builds an attach:player torch with defaults', () => {
    expect(playerTorchLight()).toEqual({
      id: 'player-torch',
      kind: 'point',
      color: '#ff8800',
      intensity: 1,
      range: 3,
      attach: 'player',
    });
  });

  it('replaces prior player attaches and same id; keeps npc attaches', () => {
    const existing: LightDocument[] = [
      {
        id: 'old-torch',
        kind: 'point',
        color: '#ffffff',
        intensity: 1,
        range: 2,
        attach: 'player',
      },
      {
        id: 'npc-glow',
        kind: 'point',
        color: '#00ff00',
        intensity: 1,
        range: 2,
        attach: 'npc-1',
      },
      {
        id: 'stamp-light-1',
        kind: 'point',
        color: '#ffaa00',
        intensity: 1,
        range: 5,
        x: 1,
        y: 1,
        floor: 'floor-0',
      },
    ];
    const next = ensurePlayerTorch(existing, { color: '#ff8800' });
    expect(next.map((l) => l.id)).toEqual(['npc-glow', 'stamp-light-1', 'player-torch']);
    expect(next.find((l) => l.id === 'player-torch')?.attach).toBe('player');
  });
});
