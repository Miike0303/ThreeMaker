import { describe, expect, it } from 'vitest';
import {
  clampFurnitureDensity,
  DEFAULT_FURNITURE_DENSITY,
  furnitureDensityFromPercent,
  furnitureDensityToPercent,
  nextProcgenSeed,
  PROCGEN_SEED_HISTORY_MAX,
  pushProcgenSeedHistory,
  randomProcgenSeed,
} from '../src/procgen/seed.js';

describe('nextProcgenSeed', () => {
  it('keeps the incremented seed unsigned across the signed 32-bit boundary', () => {
    expect(nextProcgenSeed(0x7fffffff)).toBe(0x80000000);
  });

  it('increments as uint32 and wraps', () => {
    expect(nextProcgenSeed(0)).toBe(1);
    expect(nextProcgenSeed(41)).toBe(42);
    expect(nextProcgenSeed(0xffffffff)).toBe(0);
    expect(nextProcgenSeed(-1)).toBe(0); // -1 >>> 0 = 0xffffffff, +1 wraps
  });
});

describe('randomProcgenSeed', () => {
  it('keeps the largest RNG sample below one within the documented seed range', () => {
    expect(randomProcgenSeed(() => 1 - Number.EPSILON / 2)).toBe(999_999_999);
  });

  it('maps rng output into 0..1e9 range', () => {
    expect(randomProcgenSeed(() => 0)).toBe(0);
    expect(randomProcgenSeed(() => 0.5)).toBe(500_000_000);
    expect(randomProcgenSeed(() => Number.NaN)).toBe(0);
  });

  it('maps a negative rng sample into the same range as its magnitude', () => {
    expect(randomProcgenSeed(() => -0.25)).toBe(250_000_000);
  });
});

describe('clampFurnitureDensity', () => {
  it('clamps a negative fallback to zero for a non-finite density', () => {
    expect(clampFurnitureDensity(Number.NaN, -0.25)).toBe(0);
  });

  it('caps an oversized fallback at full furniture density', () => {
    expect(clampFurnitureDensity(Number.NaN, 2)).toBe(1);
  });

  it('uses the default when both density and its fallback are non-finite', () => {
    expect(clampFurnitureDensity(Number.NaN, Number.NaN)).toBe(DEFAULT_FURNITURE_DENSITY);
  });
  it('clamps to [0,1] and falls back on non-finite', () => {
    expect(clampFurnitureDensity(0.06)).toBe(0.06);
    expect(clampFurnitureDensity(-1)).toBe(0);
    expect(clampFurnitureDensity(2)).toBe(1);
    expect(clampFurnitureDensity(Number.NaN)).toBe(DEFAULT_FURNITURE_DENSITY);
  });

  it('uses a finite caller fallback for an invalid density', () => {
    expect(clampFurnitureDensity(Number.NaN, 0.25)).toBe(0.25);
  });
});

describe('furniture density percent round-trip', () => {
  it('caps an oversized density at 100 percent for the UI', () => {
    expect(furnitureDensityToPercent(1.5)).toBe(100);
  });

  it('caps an oversized UI percentage at full furniture density', () => {
    expect(furnitureDensityFromPercent(150)).toBe(1);
  });

  it('rounds a density percentage down when it is below the half-percent boundary', () => {
    expect(furnitureDensityToPercent(0.124)).toBe(12);
  });

  it('uses the default density for non-finite percentages', () => {
    for (const percent of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(furnitureDensityFromPercent(percent)).toBe(DEFAULT_FURNITURE_DENSITY);
    }
  });

  it('rounds a fractional density percentage to the nearest integer', () => {
    expect(furnitureDensityToPercent(0.126)).toBe(13);
  });

  it('converts percent ↔ density', () => {
    expect(furnitureDensityFromPercent(6)).toBeCloseTo(0.06);
    expect(furnitureDensityFromPercent(0)).toBe(0);
    expect(furnitureDensityFromPercent(100)).toBe(1);
    expect(furnitureDensityToPercent(0.06)).toBe(6);
    expect(furnitureDensityToPercent(0.5)).toBe(50);
  });
});

describe('pushProcgenSeedHistory', () => {
  it('normalizes retained history seeds to unsigned values', () => {
    expect(pushProcgenSeedHistory([-1, 5], 7)).toEqual([7, 0xffffffff, 5]);
  });

  it('rounds a fractional seed history limit down', () => {
    expect(pushProcgenSeedHistory([30, 20, 10], 40, 2.9)).toEqual([40, 30]);
  });

  it('prepends newest and caps length', () => {
    let h: readonly number[] = [];
    h = pushProcgenSeedHistory(h, 1);
    h = pushProcgenSeedHistory(h, 2);
    h = pushProcgenSeedHistory(h, 3);
    expect(h).toEqual([3, 2, 1]);
    for (let i = 4; i < 4 + PROCGEN_SEED_HISTORY_MAX; i++) {
      h = pushProcgenSeedHistory(h, i);
    }
    expect(h).toHaveLength(PROCGEN_SEED_HISTORY_MAX);
    expect(h[0]).toBe(3 + PROCGEN_SEED_HISTORY_MAX);
  });

  it('moves an unsigned-equivalent history seed to the front without duplicating it', () => {
    expect(pushProcgenSeedHistory([-1, 7], 0xffffffff)).toEqual([0xffffffff, 7]);
  });

  it('moves duplicate seed to front without doubling', () => {
    const h = pushProcgenSeedHistory([10, 20, 30], 20);
    expect(h).toEqual([20, 10, 30]);
  });

  it('coerces seeds to uint32', () => {
    expect(pushProcgenSeedHistory([], -1)).toEqual([0xffffffff]);
  });

  it('keeps the newest seed when the requested history limit is zero', () => {
    expect(pushProcgenSeedHistory([3, 2], 1, 0)).toEqual([1]);
  });
});
