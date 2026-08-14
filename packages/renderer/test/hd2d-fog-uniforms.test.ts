/**
 * C8 WU-02: fog uniform handles + setFog write path (pure, headless).
 * Full createHd2dPipeline needs a real WebGPU renderer — we test the extracted
 * uniform trio and apply helper, same values the pipeline uses.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_HD2D_KNOBS } from '../src/runtime/hd2d-knobs.js';
import { applyFogUniforms, createFogUniforms } from '../src/runtime/hd2d-pipeline.js';

describe('createFogUniforms', () => {
  it('initializes color/near/far from knob defaults (byte-identical start)', () => {
    const fog = createFogUniforms(DEFAULT_HD2D_KNOBS.fog);
    expect(fog.color.value.getHex()).toBe(DEFAULT_HD2D_KNOBS.fog.color);
    expect(fog.near.value).toBe(DEFAULT_HD2D_KNOBS.fog.near);
    expect(fog.far.value).toBe(DEFAULT_HD2D_KNOBS.fog.far);
  });

  it('accepts a custom fog trio', () => {
    const fog = createFogUniforms({ color: 0xff00ff, near: 1, far: 9 });
    expect(fog.color.value.getHex()).toBe(0xff00ff);
    expect(fog.near.value).toBe(1);
    expect(fog.far.value).toBe(9);
  });
});

describe('applyFogUniforms (setFog write path)', () => {
  it('updates all three uniform values', () => {
    const fog = createFogUniforms(DEFAULT_HD2D_KNOBS.fog);
    applyFogUniforms(fog, 0x112233, 3, 12);
    expect(fog.color.value.getHex()).toBe(0x112233);
    expect(fog.near.value).toBe(3);
    expect(fog.far.value).toBe(12);
  });

  it('can restore knob defaults after a denser fog mode write', () => {
    const fog = createFogUniforms(DEFAULT_HD2D_KNOBS.fog);
    applyFogUniforms(
      fog,
      DEFAULT_HD2D_KNOBS.fog.color,
      DEFAULT_HD2D_KNOBS.fog.near * 0.35,
      DEFAULT_HD2D_KNOBS.fog.far * 0.45,
    );
    expect(fog.near.value).toBeCloseTo(DEFAULT_HD2D_KNOBS.fog.near * 0.35);
    expect(fog.far.value).toBeCloseTo(DEFAULT_HD2D_KNOBS.fog.far * 0.45);

    applyFogUniforms(
      fog,
      DEFAULT_HD2D_KNOBS.fog.color,
      DEFAULT_HD2D_KNOBS.fog.near,
      DEFAULT_HD2D_KNOBS.fog.far,
    );
    expect(fog.near.value).toBe(DEFAULT_HD2D_KNOBS.fog.near);
    expect(fog.far.value).toBe(DEFAULT_HD2D_KNOBS.fog.far);
  });
});
