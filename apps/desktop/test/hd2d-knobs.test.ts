import { describe, expect, it } from 'vitest';
import { clampFocusDistance, DEFAULT_HD2D_KNOBS, resolveKnobs } from '../src/hd2d-knobs.js';

describe('resolveKnobs', () => {
  it('returns the default knobs when called with no overrides', () => {
    expect(resolveKnobs()).toEqual(DEFAULT_HD2D_KNOBS);
  });

  it('returns the default knobs when called with undefined', () => {
    expect(resolveKnobs(undefined)).toEqual(DEFAULT_HD2D_KNOBS);
  });

  it('merges a partial override into one group while keeping the rest at defaults', () => {
    const resolved = resolveKnobs({ bloom: { strength: 0.9 } });
    expect(resolved.bloom).toEqual({ ...DEFAULT_HD2D_KNOBS.bloom, strength: 0.9 });
    expect(resolved.fog).toEqual(DEFAULT_HD2D_KNOBS.fog);
    expect(resolved.dof).toEqual(DEFAULT_HD2D_KNOBS.dof);
    expect(resolved.vignette).toEqual(DEFAULT_HD2D_KNOBS.vignette);
  });

  it('merges partial overrides across several groups at once', () => {
    const resolved = resolveKnobs({
      dof: { bokehScale: 0.05 },
      vignette: { intensity: 0.6 },
    });
    expect(resolved.dof).toEqual({ ...DEFAULT_HD2D_KNOBS.dof, bokehScale: 0.05 });
    expect(resolved.vignette).toEqual({ ...DEFAULT_HD2D_KNOBS.vignette, intensity: 0.6 });
    expect(resolved.bloom).toEqual(DEFAULT_HD2D_KNOBS.bloom);
  });

  it('does not mutate DEFAULT_HD2D_KNOBS when merging overrides', () => {
    const before = JSON.parse(JSON.stringify(DEFAULT_HD2D_KNOBS));
    resolveKnobs({ fog: { near: 999 } });
    expect(DEFAULT_HD2D_KNOBS).toEqual(before);
  });
});

describe('clampFocusDistance', () => {
  it('returns the value unchanged when already within range', () => {
    expect(clampFocusDistance(10, 1, 100)).toBe(10);
  });

  it('clamps a value below the minimum up to the minimum', () => {
    expect(clampFocusDistance(-5, 1, 100)).toBe(1);
  });

  it('clamps a value above the maximum down to the maximum', () => {
    expect(clampFocusDistance(500, 1, 100)).toBe(100);
  });

  it('returns the minimum when given NaN', () => {
    expect(clampFocusDistance(Number.NaN, 1, 100)).toBe(1);
  });

  it('normalizes an inverted range (min greater than max) instead of throwing', () => {
    expect(clampFocusDistance(10, 100, 1)).toBe(10);
    expect(clampFocusDistance(-10, 100, 1)).toBe(1);
    expect(clampFocusDistance(500, 100, 1)).toBe(100);
  });
});
