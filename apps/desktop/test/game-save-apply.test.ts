import { TriggerIndex } from '@threemaker/gameplay';
import type { GameSaveSnapshot } from '@threemaker/save';
import { describe, expect, it } from 'vitest';
import {
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
