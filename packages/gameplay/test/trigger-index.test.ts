import { describe, expect, it } from 'vitest';
import type { TriggerDefinition } from '../src/trigger-index.js';
import { TriggerIndex } from '../src/trigger-index.js';

function trigger(overrides: Partial<TriggerDefinition> = {}): TriggerDefinition {
  return { id: 'gate', x: 3, y: 4, floor: 0, on: 'enter', event: 'gate-open', ...overrides };
}

describe('TriggerIndex — on-enter', () => {
  it('fires once when the player moves onto the trigger tile', () => {
    const index = new TriggerIndex([trigger()], { x: 0, y: 0, floor: 0 });

    expect(index.enter(0, 1, 0)).toEqual([]);
    expect(index.enter(0, 2, 0)).toEqual([]);
    expect(index.enter(0, 3, 4)).toEqual(['gate-open']);
  });

  it('does not re-fire while standing still on the same tile', () => {
    const index = new TriggerIndex([trigger()], { x: 0, y: 0, floor: 0 });

    expect(index.enter(0, 3, 4)).toEqual(['gate-open']);
    expect(index.enter(0, 3, 4)).toEqual([]);
    expect(index.enter(0, 3, 4)).toEqual([]);
  });

  it('re-fires after leaving the tile and re-entering it', () => {
    const index = new TriggerIndex([trigger()], { x: 0, y: 0, floor: 0 });

    expect(index.enter(0, 3, 4)).toEqual(['gate-open']);
    expect(index.enter(0, 3, 5)).toEqual([]); // leaves
    expect(index.enter(0, 3, 4)).toEqual(['gate-open']); // re-enters
  });

  it('does not fire for a trigger on the tile the index was constructed with', () => {
    const index = new TriggerIndex([trigger()], { x: 3, y: 4, floor: 0 });

    expect(index.enter(0, 3, 4)).toEqual([]); // no move happened yet
  });

  it('fires for every "enter" trigger sharing the same tile', () => {
    const index = new TriggerIndex(
      [trigger({ id: 'a', event: 'event-a' }), trigger({ id: 'b', event: 'event-b' })],
      { x: 0, y: 0, floor: 0 },
    );

    expect(index.enter(0, 3, 4)).toEqual(['event-a', 'event-b']);
  });

  it('does not fire "interact" triggers from enter()', () => {
    const index = new TriggerIndex([trigger({ on: 'interact', event: 'talk' })], {
      x: 0,
      y: 0,
      floor: 0,
    });

    expect(index.enter(0, 3, 4)).toEqual([]);
  });

  it('fires immediately when constructed without an initial tile and the first move lands on a trigger', () => {
    const index = new TriggerIndex([trigger()]);

    expect(index.enter(0, 3, 4)).toEqual(['gate-open']);
  });
});

describe('TriggerIndex — floor scoping', () => {
  it('does not fire another floor\'s "enter" trigger at the same tile', () => {
    const index = new TriggerIndex([trigger({ floor: 1 })], { x: 0, y: 0, floor: 0 });

    expect(index.enter(0, 3, 4)).toEqual([]);
    expect(index.enter(1, 3, 4)).toEqual(['gate-open']);
  });

  it('fires only the reported floor\'s "enter" trigger when two floors share a tile', () => {
    const index = new TriggerIndex(
      [
        trigger({ id: 'g0', floor: 0, event: 'ground-open' }),
        trigger({ id: 'g1', floor: 1, event: 'upstairs-open' }),
      ],
      { x: 0, y: 0, floor: 0 },
    );

    expect(index.enter(0, 3, 4)).toEqual(['ground-open']);
    expect(index.enter(1, 3, 4)).toEqual(['upstairs-open']);
  });

  it('does not fire another floor\'s "interact" trigger from interact()', () => {
    const index = new TriggerIndex([trigger({ on: 'interact', event: 'talk', floor: 1 })]);

    expect(index.interact(0, 3, 5, 'up')).toEqual([]);
    expect(index.interact(1, 3, 5, 'up')).toEqual(['talk']);
  });

  // The per-tile-change dedup of `enter()` is preserved, with the floor now
  // part of "the tile": standing still on one floor still never re-fires, but
  // arriving at the same x,y on a DIFFERENT floor is a fresh arrival.
  it('keeps per-tile-change dedup and treats a same-tile floor change as a fresh arrival', () => {
    const index = new TriggerIndex(
      [trigger({ floor: 0 }), trigger({ id: 'up', floor: 1, event: 'upstairs-open' })],
      { x: 0, y: 0, floor: 0 },
    );

    expect(index.enter(0, 3, 4)).toEqual(['gate-open']);
    expect(index.enter(0, 3, 4)).toEqual([]);
    expect(index.enter(1, 3, 4)).toEqual(['upstairs-open']);
    expect(index.enter(1, 3, 4)).toEqual([]);
  });
});

describe('TriggerIndex — on-interact', () => {
  it('fires when the player is adjacent to and facing the trigger tile', () => {
    const index = new TriggerIndex([trigger({ on: 'interact', event: 'talk', x: 3, y: 4 })]);

    // Player stands at (3, 5), facing up -> faces (3, 4).
    expect(index.interact(0, 3, 5, 'up')).toEqual(['talk']);
  });

  it('does not fire when adjacent but facing the wrong direction', () => {
    const index = new TriggerIndex([trigger({ on: 'interact', event: 'talk', x: 3, y: 4 })]);

    expect(index.interact(0, 3, 5, 'down')).toEqual([]);
  });

  it('does not fire when facing the right direction but not adjacent', () => {
    const index = new TriggerIndex([trigger({ on: 'interact', event: 'talk', x: 3, y: 4 })]);

    expect(index.interact(0, 3, 6, 'up')).toEqual([]);
  });

  it('fires for every "interact" trigger sharing the faced tile', () => {
    const index = new TriggerIndex([
      trigger({ id: 'a', on: 'interact', event: 'event-a', x: 3, y: 4 }),
      trigger({ id: 'b', on: 'interact', event: 'event-b', x: 3, y: 4 }),
    ]);

    expect(index.interact(0, 3, 5, 'up')).toEqual(['event-a', 'event-b']);
  });

  it('does not fire "enter" triggers from interact()', () => {
    const index = new TriggerIndex([trigger({ on: 'enter', event: 'gate-open', x: 3, y: 4 })]);

    expect(index.interact(0, 3, 5, 'up')).toEqual([]);
  });
});
