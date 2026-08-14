import { Inventory, StatBlock, TriggerIndex } from '@threemaker/gameplay';
import { captureInkStoryStates, compileInk } from '@threemaker/narrative';
import type { GameSaveSnapshot, SaveWorldValue } from '@threemaker/save';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyGameSaveSessionStores,
  applyGameSaveStoryStates,
  resolveMapFileInCatalog,
  sameMapLoadNarrativeArrival,
  validateSavePlacement,
} from '../src/game-save-apply.js';

const snap = (partial: Partial<GameSaveSnapshot> = {}): GameSaveSnapshot => ({
  mapFile: 'demo/map-a.tmmap.json',
  x: 1,
  y: 2,
  floor: 0,
  facing: 'down',
  world: {},
  inventory: {},
  stats: {},
  stories: {},
  ...partial,
});

describe('resolveMapFileInCatalog', () => {
  it('accepts an exact catalog entry', () => {
    expect(
      resolveMapFileInCatalog('demo/map-a.tmmap.json', {
        files: ['demo/map-a.tmmap.json', 'demo/map-b.tmmap.json'],
      }),
    ).toEqual({ ok: true, mapFile: 'demo/map-a.tmmap.json' });
  });

  it('rejects unknown or empty mapFile without basename fallback', () => {
    expect(
      resolveMapFileInCatalog('other.tmmap.json', { files: ['demo/map-a.tmmap.json'] }).ok,
    ).toBe(false);
    expect(resolveMapFileInCatalog('', { files: ['a'] }).ok).toBe(false);
    // Basename-only match is NOT enough for save-load (ambiguous).
    expect(
      resolveMapFileInCatalog('map-a.tmmap.json', { files: ['demo/map-a.tmmap.json'] }).ok,
    ).toBe(false);
  });
});

describe('validateSavePlacement', () => {
  const geo = { floorCount: 2, width: 10, height: 8 };

  it('accepts in-bounds floor and tile', () => {
    expect(validateSavePlacement(snap({ x: 0, y: 0, floor: 1 }), geo)).toEqual({ ok: true });
    expect(validateSavePlacement(snap({ x: 9, y: 7, floor: 0 }), geo)).toEqual({ ok: true });
  });

  it('rejects floor outside the loaded map', () => {
    const r = validateSavePlacement(snap({ floor: 2 }), geo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('floor-out-of-range');
  });

  it('rejects x/y outside the grid', () => {
    const r = validateSavePlacement(snap({ x: 10, y: 0 }), geo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('position-out-of-bounds');
    const r2 = validateSavePlacement(snap({ x: 0, y: -1 }), geo);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('position-out-of-bounds');
  });
});

describe('applyGameSaveSessionStores', () => {
  function makeStores(seed?: {
    world?: Record<string, SaveWorldValue>;
    inventory?: Record<string, number>;
    stats?: Record<string, number>;
  }) {
    // Lightweight stand-ins matching the duck-typed replaceAll surface.
    const worldMap = new Map<string, SaveWorldValue>(Object.entries(seed?.world ?? {}));
    const inventory = new Inventory();
    if (seed?.inventory) inventory.replaceAll(seed.inventory);
    const stats = new StatBlock([
      { id: 'hp', name: 'HP', base: 10, min: 0, max: 100 },
      { id: 'mp', name: 'MP', base: 5, min: 0, max: 50 },
    ]);
    if (seed?.stats) stats.replaceAll(seed.stats);
    return {
      world: {
        replaceAll(values: Readonly<Record<string, SaveWorldValue>>) {
          worldMap.clear();
          for (const [k, v] of Object.entries(values)) worldMap.set(k, v);
        },
        snapshot(): Record<string, SaveWorldValue> {
          return Object.fromEntries(worldMap);
        },
      },
      inventory,
      stats,
    };
  }

  it('restores world, inventory, and stats from the snapshot', () => {
    const stores = makeStores({
      world: { old: true },
      inventory: { scrap: 9 },
      stats: { hp: 1, mp: 1 },
    });
    const result = applyGameSaveSessionStores(
      {
        world: { met: true, gold: 3 },
        inventory: { potion: 2 },
        stats: { hp: 40, mp: 20 },
      },
      stores,
    );
    expect(result).toEqual({ ok: true });
    expect(stores.world.snapshot()).toEqual({ met: true, gold: 3 });
    expect(stores.inventory.snapshot()).toEqual({ potion: 2 });
    expect(stores.stats.snapshot()).toEqual({ hp: 40, mp: 20 });
  });

  it('fails cleanly on unknown stats without half-applying any store', () => {
    const stores = makeStores({
      world: { keep: true },
      inventory: { potion: 4 },
      stats: { hp: 30, mp: 15 },
    });
    const before = {
      world: stores.world.snapshot(),
      inventory: stores.inventory.snapshot(),
      stats: stores.stats.snapshot(),
    };
    const result = applyGameSaveSessionStores(
      {
        world: { wiped: true },
        inventory: { key: 1 },
        stats: { hp: 50, unknown_stat: 1 },
      },
      stores,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('stats-unknown');
      expect(result.message).toMatch(/unknown_stat/);
    }
    expect(stores.world.snapshot()).toEqual(before.world);
    expect(stores.inventory.snapshot()).toEqual(before.inventory);
    expect(stores.stats.snapshot()).toEqual(before.stats);
  });

  it('fails cleanly on bad inventory counts without half-applying', () => {
    const stores = makeStores({
      world: { keep: true },
      inventory: { potion: 4 },
      stats: { hp: 30, mp: 15 },
    });
    const before = {
      world: stores.world.snapshot(),
      inventory: stores.inventory.snapshot(),
      stats: stores.stats.snapshot(),
    };
    const result = applyGameSaveSessionStores(
      {
        world: { wiped: true },
        inventory: { potion: -3 },
        stats: { hp: 1 },
      },
      stores,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('inventory-invalid');
      expect(result.message).toMatch(/potion/);
    }
    expect(stores.world.snapshot()).toEqual(before.world);
    expect(stores.inventory.snapshot()).toEqual(before.inventory);
    expect(stores.stats.snapshot()).toEqual(before.stats);
  });

  it('loads a v1-era empty inventory/stats snapshot by clearing session stores', () => {
    // Migration yields empty stores; apply must clear prior session bags and
    // reset stats to base (empty record → every def base).
    const stores = makeStores({
      world: { leftover: true },
      inventory: { potion: 7 },
      stats: { hp: 99, mp: 40 },
    });
    const result = applyGameSaveSessionStores(
      { world: { met_elder: true }, inventory: {}, stats: {} },
      stores,
    );
    expect(result).toEqual({ ok: true });
    expect(stores.world.snapshot()).toEqual({ met_elder: true });
    expect(stores.inventory.snapshot()).toEqual({});
    expect(stores.stats.snapshot()).toEqual({ hp: 10, mp: 5 }); // bases
  });
});

describe('sameMapLoadNarrativeArrival (TriggerIndex enter dedupe)', () => {
  /**
   * Same-map load must seed TriggerIndex with the *saved* player tile.
   * Using boot `session.spawn` (the pre-fix main.ts default) treats the save
   * tile as a fresh enter on the first game-loop frame.
   */
  it('does not fire an on-enter trigger underfoot after load; re-enter does', () => {
    const bootSpawn = { x: 0, y: 0, floor: 0 };
    const saveTile = { x: 5, y: 5, floor: 0 };
    const enterTrigger = {
      id: 'pad',
      x: 5,
      y: 5,
      floor: 0,
      on: 'enter' as const,
      event: 'stepped',
    };

    // Counterfactual: boot-spawn arrival (buggy same-map rebuild) fires on first enter.
    const buggy = new TriggerIndex([enterTrigger], bootSpawn);
    expect(buggy.enter(saveTile.floor, saveTile.x, saveTile.y)).toEqual(['stepped']);

    // Fixed arrival: save tile is already-entered.
    const arrival = sameMapLoadNarrativeArrival(saveTile);
    expect(arrival).toEqual(saveTile);
    const index = new TriggerIndex([enterTrigger], arrival);
    expect(index.enter(saveTile.floor, saveTile.x, saveTile.y)).toEqual([]);
    expect(index.enter(saveTile.floor, saveTile.x + 1, saveTile.y)).toEqual([]);
    expect(index.enter(saveTile.floor, saveTile.x, saveTile.y)).toEqual(['stepped']);
  });
});

describe('applyGameSaveStoryStates', () => {
  const source = `VAR token = 0
Alpha.
~ token = 1
Beta.
Gamma.
-> END
`;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores a mid-story cursor so the next line matches after reload', () => {
    const live = compileInk(source);
    live.Continue();
    live.Continue();
    const saved = captureInkStoryStates(new Map([['elder', live]]));

    const reloaded = compileInk(source);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = applyGameSaveStoryStates(new Map([['elder', reloaded]]), saved);

    expect(result).toEqual({ restored: ['elder'], skipped: [] });
    expect(warn).not.toHaveBeenCalled();
    expect(reloaded.Continue()?.trim()).toBe('Gamma.');
  });

  it('warns once with skipped ids when a saved story is missing from the registry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = applyGameSaveStoryStates(new Map(), { retired: '{"inkSaveVersion":8}' });
    expect(result.skipped).toEqual(['retired']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('retired'));
  });
});
