/**
 * C6 WU-04: pure helpers for opt-in lit tile materials + ambient parity.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  baseSceneLightSetup,
  buildSheetLightingOptions,
  dayNightAmbientFactor,
  mapHasAuthoredLights,
} from '../src/sheet-tile-lighting.js';

describe('mapHasAuthoredLights', () => {
  it('is true only when the lights array is non-empty', () => {
    expect(mapHasAuthoredLights([])).toBe(false);
    expect(mapHasAuthoredLights([{ id: 'torch' }])).toBe(true);
  });
});

describe('buildSheetLightingOptions (seam into StreamingTilemapScene)', () => {
  it('map with lights → { lit: true } (and lightMap when present)', () => {
    expect(buildSheetLightingOptions(true)).toEqual({ lit: true });

    const lightMap = new THREE.Texture();
    expect(buildSheetLightingOptions(true, lightMap)).toEqual({
      lit: true,
      lightMap,
    });
  });

  it('map without lights → undefined (or lightMap-only bag when a baked map is authored)', () => {
    expect(buildSheetLightingOptions(false)).toBeUndefined();

    const lightMap = new THREE.Texture();
    expect(buildSheetLightingOptions(false, lightMap)).toEqual({ lightMap });
  });
});

describe('baseSceneLightSetup (ambient parity)', () => {
  it("unlit maps keep today's directional + cool ambient", () => {
    expect(baseSceneLightSetup(false)).toEqual({
      ambient: { color: 0x404060, intensity: 2 },
      directional: { color: 0xffffff, intensity: 3 },
    });
  });

  it('lit maps use white ambient at Math.PI and zero the directional', () => {
    // Lambert divides by π; intensity π ≈ unlit MeshBasic base brightness so
    // authored point/spot lights read as additions, not the only illumination.
    expect(baseSceneLightSetup(true)).toEqual({
      ambient: { color: 0xffffff, intensity: Math.PI },
      directional: null,
    });
  });
});

describe('dayNightAmbientFactor (C7 WU-02)', () => {
  it('hits exact control-point values', () => {
    expect(dayNightAmbientFactor(300)).toBeCloseTo(0.35); // 05:00
    expect(dayNightAmbientFactor(420)).toBeCloseTo(1.0); // 07:00
    expect(dayNightAmbientFactor(1080)).toBeCloseTo(1.0); // 18:00
    expect(dayNightAmbientFactor(1320)).toBeCloseTo(0.35); // 22:00
    expect(dayNightAmbientFactor(0)).toBeCloseTo(0.35); // 00:00
  });

  it('interpolates midpoints on dawn and dusk ramps', () => {
    // 06:00 = halfway 05:00(0.35) → 07:00(1.0) → 0.675
    expect(dayNightAmbientFactor(360)).toBeCloseTo(0.675);
    // 20:00 = halfway 18:00(1.0) → 22:00(0.35) → 0.675
    expect(dayNightAmbientFactor(1200)).toBeCloseTo(0.675);
  });

  it('keeps wrap continuity across midnight', () => {
    expect(dayNightAmbientFactor(1439)).toBeCloseTo(dayNightAmbientFactor(0), 5);
    expect(dayNightAmbientFactor(1439)).toBeCloseTo(0.35);
  });
});
