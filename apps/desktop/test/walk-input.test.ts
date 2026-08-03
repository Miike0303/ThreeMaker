import { describe, expect, it } from 'vitest';
import { createMostRecentHeldDirection, directionFromMoveKey } from '../src/walk-input.js';

describe('directionFromMoveKey', () => {
  it('maps WASD and arrows (any casing) to grid directions', () => {
    expect(directionFromMoveKey('w')).toBe('up');
    expect(directionFromMoveKey('ArrowUp')).toBe('up');
    expect(directionFromMoveKey('S')).toBe('down');
    expect(directionFromMoveKey('a')).toBe('left');
    expect(directionFromMoveKey('ArrowRight')).toBe('right');
  });

  it('returns undefined for non-movement keys', () => {
    expect(directionFromMoveKey('e')).toBeUndefined();
    expect(directionFromMoveKey(' ')).toBeUndefined();
    expect(directionFromMoveKey('Escape')).toBeUndefined();
  });
});

describe('createMostRecentHeldDirection', () => {
  it('reports the most recently pressed direction still held', () => {
    const held = createMostRecentHeldDirection();
    held.press('w');
    held.press('d');
    expect(held.current()).toBe('right');
    held.release('d');
    expect(held.current()).toBe('up');
  });

  it('re-pressing a held key moves it to most-recent without duplicating', () => {
    const held = createMostRecentHeldDirection();
    held.press('a');
    held.press('w');
    held.press('a');
    expect(held.current()).toBe('left');
    held.release('a');
    expect(held.current()).toBe('up');
  });

  it('ignores non-movement keys on press and release', () => {
    const held = createMostRecentHeldDirection();
    held.press('e');
    expect(held.current()).toBeUndefined();
    held.press('w');
    held.release('e');
    expect(held.current()).toBe('up');
  });

  it('clear drops all held directions (script-end anti-auto-walk)', () => {
    const held = createMostRecentHeldDirection();
    held.press('w');
    held.press('a');
    held.clear();
    expect(held.current()).toBeUndefined();
  });
});
