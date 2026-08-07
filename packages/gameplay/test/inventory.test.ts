import { describe, expect, it, vi } from 'vitest';
import { Inventory } from '../src/inventory.js';

describe('Inventory', () => {
  it('count() returns 0 for an absent item', () => {
    const inv = new Inventory();
    expect(inv.count('potion')).toBe(0);
  });

  it('has() is false when count is 0 and true when positive', () => {
    const inv = new Inventory();
    expect(inv.has('potion')).toBe(false);
    inv.add('potion', 1);
    expect(inv.has('potion')).toBe(true);
  });

  it('add() returns the new count and stores positive counts', () => {
    const inv = new Inventory();
    expect(inv.add('potion', 3)).toBe(3);
    expect(inv.count('potion')).toBe(3);
    expect(inv.add('potion', 2)).toBe(5);
  });

  it('add() clamps at 0 and removes the entry when count reaches 0', () => {
    const inv = new Inventory();
    inv.add('potion', 2);
    expect(inv.add('potion', -5)).toBe(0);
    expect(inv.count('potion')).toBe(0);
    expect(inv.has('potion')).toBe(false);
    expect(inv.snapshot()).toEqual({});
  });

  it('add() with delta 0 is a no-op (no signal)', () => {
    const inv = new Inventory();
    inv.add('potion', 2);
    const listener = vi.fn();
    inv.signals.on('changed', listener);
    expect(inv.add('potion', 0)).toBe(2);
    expect(listener).not.toHaveBeenCalled();
  });

  it('negative add on an absent item emits no signal and returns 0', () => {
    const inv = new Inventory();
    const listener = vi.fn();
    inv.signals.on('changed', listener);
    expect(inv.add('absent', -3)).toBe(0);
    expect(inv.count('absent')).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('throws on non-integer or non-finite delta', () => {
    const inv = new Inventory();
    expect(() => inv.add('potion', 1.5)).toThrow(/integer|delta/i);
    expect(() => inv.add('potion', Number.NaN)).toThrow(/integer|delta|finite/i);
    expect(() => inv.add('potion', Number.POSITIVE_INFINITY)).toThrow(/integer|delta|finite/i);
  });

  it('emits changed with { itemId, count, previous } on successful add', () => {
    const inv = new Inventory();
    const listener = vi.fn();
    inv.signals.on('changed', listener);

    inv.add('potion', 3);
    expect(listener).toHaveBeenCalledWith({ itemId: 'potion', count: 3, previous: 0 });

    inv.add('potion', -1);
    expect(listener).toHaveBeenLastCalledWith({ itemId: 'potion', count: 2, previous: 3 });
  });

  it('snapshot() returns a plain object of only positive counts (fresh copy)', () => {
    const inv = new Inventory();
    inv.add('potion', 2);
    inv.add('key', 1);
    const snap = inv.snapshot();
    expect(snap).toEqual({ potion: 2, key: 1 });
    snap.potion = 99;
    expect(inv.count('potion')).toBe(2);
  });

  it('replaceAll installs counts silently, drops zeros, and clears prior keys', () => {
    const inv = new Inventory();
    const listener = vi.fn();
    inv.signals.on('changed', listener);
    inv.add('old', 5);

    inv.replaceAll({ potion: 3, key: 0, scrap: 1 });

    expect(inv.snapshot()).toEqual({ potion: 3, scrap: 1 });
    expect(inv.has('old')).toBe(false);
    // Only the initial add emitted — replaceAll is silent.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('replaceAll throws naming the bad key for non-negative-integer violations', () => {
    const inv = new Inventory();
    expect(() => inv.replaceAll({ potion: -1 })).toThrow(/potion/i);
    expect(() => inv.replaceAll({ potion: 1.5 })).toThrow(/potion/i);
    expect(() => inv.replaceAll({ potion: Number.NaN })).toThrow(/potion/i);
  });

  it('does not validate item ids against a catalog', () => {
    const inv = new Inventory();
    expect(() => inv.add('unknown_item', 1)).not.toThrow();
    expect(inv.count('unknown_item')).toBe(1);
  });
});
