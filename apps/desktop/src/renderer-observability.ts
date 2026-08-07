/**
 * Pure helpers for desktop renderer observability (C6 WU-03): backend name
 * mapping and cheap frame-time EMA. Kept free of DOM / WebGPU so vitest can
 * drive them under `environment: 'node'`.
 */

/** Runtime backend label exposed on `window.__threemaker_debug.backend`. */
export type RendererBackendLabel = 'webgpu' | 'webgl2';

/**
 * Maps a three r184 renderer `.backend` object to a stable label.
 * Prefer constructor name (`WebGPUBackend` / `WebGLBackend`); fall back to the
 * `isWebGPUBackend` / `isWebGLBackend` flags three sets on those classes.
 */
export function mapRendererBackendName(backend: unknown): RendererBackendLabel {
  if (backend && typeof backend === 'object') {
    const ctorName =
      typeof (backend as { constructor?: { name?: string } }).constructor?.name === 'string'
        ? (backend as { constructor: { name: string } }).constructor.name
        : '';
    if (/webgl/i.test(ctorName)) return 'webgl2';
    if (/webgpu/i.test(ctorName)) return 'webgpu';
    if ((backend as { isWebGLBackend?: boolean }).isWebGLBackend === true) return 'webgl2';
    if ((backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true) return 'webgpu';
  }
  // Unknown / missing backend: report the optimistic default three targets first.
  return 'webgpu';
}

/**
 * Exponential moving average of frame time in milliseconds.
 * `prevEma <= 0` (or first sample) seeds to the raw `nowMs - lastMs` delta.
 */
export function smoothFrameTimeMs(
  prevEma: number,
  nowMs: number,
  lastMs: number,
  alpha = 0.1,
): number {
  const sample = nowMs - lastMs;
  if (!(prevEma > 0)) return sample;
  return prevEma + alpha * (sample - prevEma);
}

/**
 * Dev toggle: `?webgl=1` forces the WebGPURenderer onto its WebGL2 backend so
 * the declared floor budget can be verified without a WebGPU-capable host.
 */
export function shouldForceWebGL(search: string): boolean {
  try {
    return new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('webgl') === '1';
  } catch {
    return false;
  }
}
