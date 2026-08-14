/**
 * Narrative root (spec R6): the SESSION-scoped half of the narrative runtime.
 * `WorldState`, the world-seed set and the dialogue overlay live here and MUST
 * survive a map swap; compiled stories, the dialogue provider, the
 * `EventInterpreter`, NPCs and triggers are per-map and are rebuilt by the
 * bundle (task 5.4) -- nothing of that kind is asserted here.
 *
 * Everything below is DOM-free on purpose: this repo's vitest runs under
 * `environment: 'node'` (no `document`), so the overlay is INJECTED as a
 * factory and the root only guarantees its lifetime -- one per session, built
 * on first request. `createDialogueOverlay` itself stays untested here, the
 * same split `dialogue-ui.test.ts` already uses.
 */

import { WorldClock } from '@threemaker/core';
import { Inventory, StatBlock } from '@threemaker/gameplay';
import { CLOCK_MINUTES_KEY, WEATHER_KEY } from '@threemaker/renderer';
import { describe, expect, it, vi } from 'vitest';
import type { DialogueOverlay } from '../src/dialogue-ui.js';
import { createNarrativeRoot } from '../src/narrative-root.js';

/** A DOM-free stand-in: the root never reads the overlay, it only owns it. */
function fakeOverlay(): DialogueOverlay {
  return {
    element: {} as HTMLElement,
    showLine: vi.fn(),
    showChoices: vi.fn(),
    setHighlightedIndex: vi.fn(),
    showError: vi.fn(),
    hide: vi.fn(),
  };
}

function makeRoot(
  createOverlay: () => DialogueOverlay = fakeOverlay,
  extras: { inventory?: Inventory; stats?: StatBlock; clock?: WorldClock } = {},
) {
  return createNarrativeRoot({
    createOverlay,
    inventory: extras.inventory,
    stats: extras.stats,
    clock: extras.clock ?? new WorldClock({ minutesPerRealSecond: 1, startMinutes: 480 }),
  });
}

describe('createNarrativeRoot', () => {
  it('exposes session inventory and stats that default to empty stores', () => {
    const root = makeRoot();

    expect(root.inventory).toBeInstanceOf(Inventory);
    expect(root.stats).toBeInstanceOf(StatBlock);
    expect(root.inventory.snapshot()).toEqual({});
    expect(root.stats.snapshot()).toEqual({});
  });

  it('keeps injected inventory and stats as the same session instances', () => {
    const inventory = new Inventory();
    const stats = new StatBlock([{ id: 'hp', name: 'HP', base: 10, min: 0, max: 100 }]);
    inventory.add('potion', 2);

    const root = makeRoot(fakeOverlay, { inventory, stats });

    expect(root.inventory).toBe(inventory);
    expect(root.stats).toBe(stats);
    expect(root.inventory.count('potion')).toBe(2);
    expect(root.stats.get('hp')).toBe(10);
  });

  it('seeds every key the world does not hold yet', () => {
    const root = makeRoot();

    root.seedIfAbsent({ secret_revealed: false, coins: 3, lastNpc: 'elder' });

    expect(root.world.snapshot()).toEqual({
      [CLOCK_MINUTES_KEY]: 480,
      [WEATHER_KEY]: 'clear',
      secret_revealed: false,
      coins: 3,
      lastNpc: 'elder',
    });
  });

  // Spec R6, "seeds are not re-applied per map": loading a second authored map
  // applies its seeds again, and a value a story changed must survive that.
  it('never overwrites a value changed after the first seed application', () => {
    const root = makeRoot();
    root.seedIfAbsent({ secret_revealed: false });

    root.world.set('secret_revealed', true);
    root.seedIfAbsent({ secret_revealed: false });

    expect(root.world.get('secret_revealed')).toBe(true);
  });

  // The guard is per-key `has`, not "only seed on the first call" -- a key can
  // already be set before any map's seeds are applied.
  it('never overwrites a key already set before any seed was applied', () => {
    const root = makeRoot();
    root.world.set('coins', 7);

    root.seedIfAbsent({ coins: 0 });

    expect(root.world.get('coins')).toBe(7);
  });

  it('applies only the absent subset when a second map seeds new keys too', () => {
    const root = makeRoot();
    root.seedIfAbsent({ carried: 1 });
    root.world.set('carried', 2);

    root.seedIfAbsent({ carried: 1, fresh: 'x' });

    expect(root.world.snapshot()).toEqual({
      [CLOCK_MINUTES_KEY]: 480,
      [WEATHER_KEY]: 'clear',
      carried: 2,
      fresh: 'x',
    });
  });

  it('emits no changed signal for a key it skips', () => {
    const root = makeRoot();
    root.seedIfAbsent({ carried: 1 });
    const changed = vi.fn();
    root.world.signals.on('changed', changed);

    root.seedIfAbsent({ carried: 1 });

    expect(changed).not.toHaveBeenCalled();
  });

  it('builds the dialogue overlay lazily and exactly once per session', () => {
    const overlay = fakeOverlay();
    const createOverlay = vi.fn(() => overlay);
    const root = makeRoot(createOverlay);

    expect(createOverlay).not.toHaveBeenCalled();
    expect(root.overlay()).toBe(overlay);
    expect(root.overlay()).toBe(overlay);
    expect(createOverlay).toHaveBeenCalledTimes(1);
  });

  // C7 WU-02: clock is session-scoped; seed clock.minutes before any map seeds.
  it('seeds clock.minutes from the injected clock at root creation', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 720 });
    const root = makeRoot(fakeOverlay, { clock });

    expect(root.clock).toBe(clock);
    expect(root.world.get(CLOCK_MINUTES_KEY)).toBe(720);
    expect(root.world.get(CLOCK_MINUTES_KEY)).toBe(clock.minutes);
  });

  it('does not let a map worldSeed override clock.minutes (seedIfAbsent skip)', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 480 });
    const root = makeRoot(fakeOverlay, { clock });

    // A map that wrongly seeds the clock as a string would type-lock fail if
    // applied — seedIfAbsent must skip the already-present numeric key.
    root.seedIfAbsent({ [CLOCK_MINUTES_KEY]: 'noon' });

    expect(root.world.get(CLOCK_MINUTES_KEY)).toBe(480);
    expect(typeof root.world.get(CLOCK_MINUTES_KEY)).toBe('number');
  });

  // C8 WU-01: weather is session-scoped; seed weather.current before any map seeds.
  it('seeds weather.current to clear at root creation', () => {
    const root = makeRoot();

    expect(root.world.get(WEATHER_KEY)).toBe('clear');
    expect(typeof root.world.get(WEATHER_KEY)).toBe('string');
  });

  it('does not let a map worldSeed override weather.current (seedIfAbsent skip)', () => {
    const root = makeRoot();

    // Maps set initial weather via enter-trigger setWorldVar, not worldSeeds.
    root.seedIfAbsent({ [WEATHER_KEY]: 'rain' });

    expect(root.world.get(WEATHER_KEY)).toBe('clear');
  });
});
