import { describe, expect, it } from 'vitest';
import {
  clampFurnitureDensity,
  DEFAULT_FURNITURE_DENSITY,
  furnitureDensityFromPercent,
  furnitureDensityToPercent,
  nextProcgenSeed,
  randomProcgenSeed,
} from '../src/procgen/seed.js';

describe('nextProcgenSeed', () => {
  it('increments as uint32 and wraps', () => {
    expect(nextProcgenSeed(0)).toBe(1);
    expect(nextProcgenSeed(41)).toBe(42);
    expect(nextProcgenSeed(0xffffffff)).toBe(0);
    expect(nextProcgenSeed(-1)).toBe(0); // -1 >>> 0 = 0xffffffff, +1 wraps
  });
});

describe('randomProcgenSeed', () => {
  it('maps rng output into 0..1e9 range', () => {
    expect(randomProcgenSeed(() => 0)).toBe(0);
    expect(randomProcgenSeed(() => 0.5)).toBe(500_000_000);
    expect(randomProcgenSeed(() => Number.NaN)).toBe(0);
  });
});

describe('clampFurnitureDensity', () => {
  it('clamps to [0,1] and falls back on non-finite', () => {
    expect(clampFurnitureDensity(0.06)).toBe(0.06);
    expect(clampFurnitureDensity(-1)).toBe(0);
    expect(clampFurnitureDensity(2)).toBe(1);
    expect(clampFurnitureDensity(Number.NaN)).toBe(DEFAULT_FURNITURE_DENSITY);
  });
});

describe('furniture density percent round-trip', () => {
  it('converts percent ↔ density', () => {
    expect(furnitureDensityFromPercent(6)).toBeCloseTo(0.06);
    expect(furnitureDensityFromPercent(0)).toBe(0);
    expect(furnitureDensityFromPercent(100)).toBe(1);
    expect(furnitureDensityToPercent(0.06)).toBe(6);
    expect(furnitureDensityToPercent(0.5)).toBe(50);
  });
});
