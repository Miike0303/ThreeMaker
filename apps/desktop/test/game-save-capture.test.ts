import { compileInk, type InkStoryRegistry } from '@threemaker/narrative';
import { describe, expect, it } from 'vitest';
import { captureGameSaveSnapshot } from '../src/game-save-capture.js';

const emptyStories: InkStoryRegistry = new Map();

describe('captureGameSaveSnapshot', () => {
  it('copies world/inventory/stats and normalizes mapFile separators', () => {
    const world = { met: true as const, gold: 2 };
    const inventory = { potion: 3 };
    const stats = { hp: 12 };
    const snap = captureGameSaveSnapshot({
      mapFile: 'demo\\map-a.tmmap.json',
      x: 1,
      y: 2,
      floor: 0,
      facing: 'left',
      world,
      inventory,
      stats,
      stories: emptyStories,
    });
    expect(snap).toEqual({
      mapFile: 'demo/map-a.tmmap.json',
      x: 1,
      y: 2,
      floor: 0,
      facing: 'left',
      world: { met: true, gold: 2 },
      inventory: { potion: 3 },
      stats: { hp: 12 },
      stories: {},
    });
    world.gold = 99;
    inventory.potion = 0;
    stats.hp = 1;
    expect(snap?.world.gold).toBe(2);
    expect(snap?.inventory.potion).toBe(3);
    expect(snap?.stats.hp).toBe(12);
  });

  it('includes captured ink story JSON keyed by storyId', () => {
    const story = compileInk('Hello, traveler.\n-> END\n');
    story.Continue();
    const snap = captureGameSaveSnapshot({
      mapFile: 'a.tmmap.json',
      x: 0,
      y: 0,
      floor: 0,
      facing: 'up',
      world: {},
      inventory: {},
      stats: {},
      stories: new Map([['elder', story]]),
    });
    expect(snap?.stories.elder).toEqual(expect.any(String));
    expect(snap?.stories.elder?.length).toBeGreaterThan(0);
  });

  it('drops zero inventory counts at capture (zeros are not stored)', () => {
    const snap = captureGameSaveSnapshot({
      mapFile: 'a.tmmap.json',
      x: 0,
      y: 0,
      floor: 0,
      facing: 'up',
      world: {},
      inventory: { potion: 2, scrap: 0 },
      stats: {},
      stories: emptyStories,
    });
    expect(snap?.inventory).toEqual({ potion: 2 });
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
        inventory: {},
        stats: {},
        stories: emptyStories,
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
        inventory: {},
        stats: {},
        stories: emptyStories,
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
        inventory: {},
        stats: {},
        stories: emptyStories,
      }),
    ).toBeUndefined();
  });

  it('rejects invalid inventory or stats values (silently disables save)', () => {
    expect(
      captureGameSaveSnapshot({
        mapFile: 'a.tmmap.json',
        x: 0,
        y: 0,
        floor: 0,
        facing: 'up',
        world: {},
        inventory: { potion: -1 },
        stats: {},
        stories: emptyStories,
      }),
    ).toBeUndefined();
    expect(
      captureGameSaveSnapshot({
        mapFile: 'a.tmmap.json',
        x: 0,
        y: 0,
        floor: 0,
        facing: 'up',
        world: {},
        inventory: {},
        stats: { hp: Number.NaN },
        stories: emptyStories,
      }),
    ).toBeUndefined();
  });
});
