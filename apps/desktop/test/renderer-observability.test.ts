/**
 * Pure backend-name mapping + frame-time EMA (C6 WU-03).
 */
import { describe, expect, it } from 'vitest';
import {
  mapRendererBackendName,
  shouldForceWebGL,
  smoothFrameTimeMs,
} from '../src/renderer-observability.js';

describe('mapRendererBackendName', () => {
  it('maps WebGPUBackend constructor name to webgpu', () => {
    class WebGPUBackend {}
    expect(mapRendererBackendName(new WebGPUBackend())).toBe('webgpu');
  });

  it('maps WebGLBackend constructor name to webgl2', () => {
    class WebGLBackend {}
    expect(mapRendererBackendName(new WebGLBackend())).toBe('webgl2');
  });

  it('falls back to isWebGLBackend / isWebGPUBackend flags', () => {
    expect(mapRendererBackendName({ isWebGLBackend: true })).toBe('webgl2');
    expect(mapRendererBackendName({ isWebGPUBackend: true })).toBe('webgpu');
  });
});

describe('smoothFrameTimeMs', () => {
  it('seeds to the raw delta when prevEma is zero', () => {
    expect(smoothFrameTimeMs(0, 116, 100)).toBeCloseTo(16);
  });

  it('applies exponential smoothing on later samples', () => {
    const seeded = smoothFrameTimeMs(0, 116, 100);
    const next = smoothFrameTimeMs(seeded, 136, 116, 0.1);
    // 16 + 0.1 * (20 - 16) = 16.4
    expect(next).toBeCloseTo(16.4);
  });
});

describe('shouldForceWebGL', () => {
  it('is true only for webgl=1', () => {
    expect(shouldForceWebGL('?webgl=1')).toBe(true);
    expect(shouldForceWebGL('webgl=1&other=2')).toBe(true);
    expect(shouldForceWebGL('?webgl=0')).toBe(false);
    expect(shouldForceWebGL('')).toBe(false);
  });
});
