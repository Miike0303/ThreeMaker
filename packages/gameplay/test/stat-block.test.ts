import { describe, expect, it, vi } from 'vitest';
import type { StatDefinition } from '../src/game-defs.js';
import { StatBlock } from '../src/stat-block.js';

const HP: StatDefinition = { id: 'hp', name: 'Hit Points', base: 10, min: 0, max: 99 };
const MP: StatDefinition = { id: 'mp', name: 'Magic Points', base: 5, min: 0, max: 50 };

describe('StatBlock', () => {
  it('starts each stat at its base', () => {
    const block = new StatBlock([HP, MP]);
    expect(block.get('hp')).toBe(10);
    expect(block.get('mp')).toBe(5);
  });

  it('throws on duplicate definition ids', () => {
    expect(() => new StatBlock([HP, { ...HP, name: 'Other' }])).toThrow(/duplicate.*hp/i);
  });

  it('get() throws on unknown id', () => {
    const block = new StatBlock([HP]);
    expect(() => block.get('unknown')).toThrow(/unknown/i);
  });

  it('set() clamps into [min, max] and returns the clamped value', () => {
    const block = new StatBlock([HP]);
    expect(block.set('hp', 150)).toBe(99);
    expect(block.get('hp')).toBe(99);
    expect(block.set('hp', -5)).toBe(0);
    expect(block.get('hp')).toBe(0);
  });

  it('set() throws on unknown id or non-finite value', () => {
    const block = new StatBlock([HP]);
    expect(() => block.set('unknown', 1)).toThrow(/unknown/i);
    expect(() => block.set('hp', Number.NaN)).toThrow(/finite/i);
    expect(() => block.set('hp', Number.POSITIVE_INFINITY)).toThrow(/finite/i);
  });

  it('set() emits changed only when the clamped value differs from previous', () => {
    const block = new StatBlock([HP]);
    const listener = vi.fn();
    block.signals.on('changed', listener);

    block.set('hp', 20);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ statId: 'hp', value: 20, previous: 10 });

    block.set('hp', 20);
    expect(listener).toHaveBeenCalledTimes(1);

    // Already at max; clamping 200 still yields 99 after first max set.
    block.set('hp', 99);
    listener.mockClear();
    block.set('hp', 200);
    expect(listener).not.toHaveBeenCalled();
  });

  it('modify() is set(get + delta)', () => {
    const block = new StatBlock([HP]);
    expect(block.modify('hp', -3)).toBe(7);
    expect(block.get('hp')).toBe(7);
    expect(block.modify('hp', 100)).toBe(99);
  });

  it('snapshot() returns every current value as a plain object copy', () => {
    const block = new StatBlock([HP, MP]);
    block.set('hp', 12);
    const snap = block.snapshot();
    expect(snap).toEqual({ hp: 12, mp: 5 });
    snap.hp = 0;
    expect(block.get('hp')).toBe(12);
  });

  it('replaceAll is silent, clamps values, throws on unknown keys, resets missing to base', () => {
    const block = new StatBlock([HP, MP]);
    const listener = vi.fn();
    block.signals.on('changed', listener);
    block.set('hp', 40);
    block.set('mp', 20);
    listener.mockClear();

    block.replaceAll({ hp: 200 });

    expect(block.get('hp')).toBe(99); // clamped
    expect(block.get('mp')).toBe(5); // reset to base
    expect(listener).not.toHaveBeenCalled();

    expect(() => block.replaceAll({ hp: 1, unknown: 2 })).toThrow(/unknown/i);
  });

  it('failed replaceAll leaves all previous values intact', () => {
    const block = new StatBlock([HP, MP]);
    block.set('hp', 40);
    block.set('mp', 20);

    // hp is valid and would be first in Map insertion order; NaN must not
    // half-apply after mutating earlier keys.
    expect(() => block.replaceAll({ hp: 5, mp: Number.NaN })).toThrow(/finite/i);
    expect(block.get('hp')).toBe(40);
    expect(block.get('mp')).toBe(20);
  });

  it('definitions() returns the defs it was built with', () => {
    const defs = [HP, MP];
    const block = new StatBlock(defs);
    expect(block.definitions()).toEqual(defs);
    expect(block.definitions()).toBe(block.definitions());
  });

  it('constructor defensive-copies defs so caller mutation cannot change clamping', () => {
    const hp: StatDefinition = { id: 'hp', name: 'Hit Points', base: 10, min: 0, max: 99 };
    const block = new StatBlock([hp]);
    hp.max = 50;
    expect(block.set('hp', 80)).toBe(80); // still clamps to original max 99
    expect(block.definitions()[0]?.max).toBe(99);
  });
});
