import { describe, expect, it } from 'vitest';
import { captureGameSaveSnapshot } from '../src/game-save-capture.js';

describe('captureGameSaveSnapshot', () => {
  it('copies world and normalizes mapFile separators', () => {
    const world = { met: true as const, gold: 2 };
    const snap = captureGameSaveSnapshot({
      mapFile: 'demo\\map-a.tmmap.json',
      x: 1,
      y: 2,
      floor: 0,
      facing: 'left',
      world,
    });
    expect(snap).toEqual({
      mapFile: 'demo/map-a.tmmap.json',
      x: 1,
      y: 2,
      floor: 0,
      facing: 'left',
      world: { met: true, gold: 2 },
    });
    world.gold = 99;
    expect(snap?.world.gold).toBe(2);
  });

  it('rejects empty mapFile, non-integer tiles, bad facing', () => {
    expect(
      captureGameSaveSnapshot({
        mapFile: '',
        x: 0,
        y: 0,
        floor: 0,
        facing: 'up',
        world: {},
      }),
    ).toBeUndefined();
    expect(
      captureGameSaveSnapshot({
        mapFile: 'a.tmmap.json',
        x: 1.5,
        y: 0,
        floor: 0,
        facing: 'up',
        world: {},
      }),
    ).toBeUndefined();
    expect(
      captureGameSaveSnapshot({
        mapFile: 'a.tmmap.json',
        x: 0,
        y: 0,
        floor: 0,
        facing: 'north' as 'up',
        world: {},
      }),
    ).toBeUndefined();
  });
});
