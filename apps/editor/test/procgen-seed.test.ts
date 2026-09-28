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

  it('uses a finite caller fallback for an invalid density', () => {
    expect(clampFurnitureDensity(Number.NaN, 0.25)).toBe(0.25);
  });
});

describe('furniture density percent round-trip', () => {
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
