import { describe, expect, it, vi } from 'vitest';
import { WorldState } from '../src/world-state.js';

describe('WorldState', () => {
  it('returns undefined for a key that was never set', () => {
    const world = new WorldState();

    expect(world.get('gold')).toBeUndefined();
  });

  it('roundtrips a value through set/get', () => {
    const world = new WorldState();

    world.set('gold', 10);

    expect(world.get('gold')).toBe(10);
  });

  it('has() reflects whether a key was ever set', () => {
    const world = new WorldState();

    expect(world.has('gold')).toBe(false);
    world.set('gold', 10);
    expect(world.has('gold')).toBe(true);
  });

  it('snapshot() returns every key/value currently stored', () => {
    const world = new WorldState();
    world.set('gold', 10);
    world.set('metCaptain', true);

    expect(world.snapshot()).toEqual({ gold: 10, metCaptain: true });
  });

  it('snapshot() reflects updates made after it was taken (fresh read, not a live view)', () => {
    const world = new WorldState();
    world.set('gold', 10);
    const first = world.snapshot();

    world.set('gold', 20);

    expect(first).toEqual({ gold: 10 });
    expect(world.snapshot()).toEqual({ gold: 20 });
  });

  it('locks a key type on first write and throws on a mismatched type in a later set', () => {
    const world = new WorldState();
    world.set('gold', 10);

    expect(() => world.set('gold', 'lots')).toThrow(
      "WorldState: key 'gold' is locked to type 'number', cannot set value of type 'string'.",
    );
  });

  it('does not throw when setting the same key with the same type again', () => {
    const world = new WorldState();
    world.set('gold', 10);

    expect(() => world.set('gold', 20)).not.toThrow();
    expect(world.get('gold')).toBe(20);
  });

  it('emits a changed signal with {key, value, previous} on every set', () => {
    const world = new WorldState();
    const listener = vi.fn();
    world.signals.on('changed', listener);

    world.set('gold', 10);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ key: 'gold', value: 10, previous: undefined });
  });

  it('emits previous as the prior value on subsequent sets of the same key', () => {
    const world = new WorldState();
    world.set('gold', 10);
    const listener = vi.fn();
    world.signals.on('changed', listener);

    world.set('gold', 20);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ key: 'gold', value: 20, previous: 10 });
  });

  it('the shared signals API notifies every subscriber of the same change', () => {
    const world = new WorldState();
    const first = vi.fn();
    const second = vi.fn();
    world.signals.on('changed', first);
    world.signals.on('changed', second);

    world.set('gold', 10);

    expect(first).toHaveBeenCalledWith({ key: 'gold', value: 10, previous: undefined });
    expect(second).toHaveBeenCalledWith({ key: 'gold', value: 10, previous: undefined });
  });
});
