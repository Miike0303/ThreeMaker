import { describe, expect, it } from 'vitest';
import { clampRange, clampTileIndex } from '../src/clamp.js';

describe('clampRange', () => {
  it('clamps within the given [min, max]', () => {
    expect(clampRange(1, 3, 20)).toBe(3);
    expect(clampRange(100, 3, 20)).toBe(20);
    expect(clampRange(10, 3, 20)).toBe(10);
  });

  it('normalizes an inverted range instead of throwing', () => {
    expect(clampRange(5, 20, 3)).toBe(5);
    expect(clampRange(-5, 20, 3)).toBe(3);
  });

  it('treats NaN as the range lower bound', () => {
    expect(clampRange(Number.NaN, 3, 20)).toBe(3);
  });
});

describe('clampTileIndex', () => {
  it('clamps into [0, size) as an integer tile index', () => {
    expect(clampTileIndex(0, 4)).toBe(0);
    expect(clampTileIndex(3, 4)).toBe(3);
    expect(clampTileIndex(-1, 4)).toBe(0);
    expect(clampTileIndex(99, 4)).toBe(3);
  });

  it('floors non-integers then clamps', () => {
    expect(clampTileIndex(1.9, 4)).toBe(1);
    expect(clampTileIndex(3.7, 4)).toBe(3);
  });

  it('returns 0 for non-finite value or non-positive size', () => {
    expect(clampTileIndex(Number.NaN, 4)).toBe(0);
    expect(clampTileIndex(2, 0)).toBe(0);
    expect(clampTileIndex(2, -1)).toBe(0);
  });
});
