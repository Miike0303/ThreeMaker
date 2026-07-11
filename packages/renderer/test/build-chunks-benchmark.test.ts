import type { RpgmTileset } from '@threemaker/importer-rpgm';
import { describe, expect, it } from 'vitest';
import { generateSyntheticMap } from '../src/dev/synthetic-map.js';
import { buildChunks } from '../src/geometry/chunk-geometry.js';
import type { SheetPixelSizes } from '../src/geometry/types.js';

/**
 * MANDATORY decision-gate benchmark (Slice 4 task 4.1): measures `buildChunks`
 * full-rebuild cost on `generateSyntheticMap` at 100x100 and 512x512, and
 * prints deterministic p95 timings to the test output.
 *
 * This test intentionally does NOT assert against a wall-clock threshold —
 * CI/dev-machine timing varies too much for that to be anything but flaky.
 * It asserts the benchmark actually RAN (produced N finite, non-negative
 * samples and a valid p95) and reports the numbers; the design's documented
 * decision rule (see `packages/renderer/src/geometry/chunk-geometry.ts`'s
 * module doc and `sdd/asset-library-y-editor-de-pintado/apply-progress`) is
 * applied by a human/agent reading the printed numbers, not by this test.
 *
 * Design's gate: p95 < 4ms at 100x100 permits a full-rebuild fallback for
 * small maps; `onlyChunks`/`patchChunks` (the incremental path) is required
 * for large maps (512x512) regardless of the 100x100 result.
 */

// Synthetic tileset covering exactly the sheets/ids `generateSyntheticMap`
// emits (A2 ground/floor autotile, A4 wall autotile, B decor) -- no real
// game fixture required, so this benchmark runs identically on every
// machine/CI without an external asset dependency.
function makeBenchmarkTileset(): RpgmTileset {
  const flags = new Array(8192).fill(0);
  return {
    id: 4,
    name: 'benchmark-dungeon',
    sheetNames: { A1: '', A2: 'A2', A3: '', A4: 'A4', A5: '', B: 'B', C: '', D: '', E: '' },
    flags,
  };
}

const SHEET_SIZES: SheetPixelSizes = {
  A2: { width: 768, height: 576 },
  A4: { width: 768, height: 720 },
  B: { width: 768, height: 768 },
};

/** Sorted-array p95: index `ceil(0.95 * n) - 1`, clamped into bounds. */
function computeP95(samplesMs: readonly number[]): number {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  const value = sorted[index];
  if (value === undefined) throw new Error('computeP95 called with an empty sample set.');
  return value;
}

function benchmarkBuildChunks(
  width: number,
  height: number,
  iterations: number,
): { readonly samplesMs: readonly number[]; readonly p95: number; readonly chunkCount: number } {
  const tileset = makeBenchmarkTileset();
  const map = generateSyntheticMap({ width, height, seed: 1 });
  const samplesMs: number[] = [];
  let chunkCount = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const chunks = buildChunks(map, tileset, SHEET_SIZES);
    const elapsed = performance.now() - start;
    samplesMs.push(elapsed);
    chunkCount = chunks.length;
  }

  return { samplesMs, p95: computeP95(samplesMs), chunkCount };
}

describe('buildChunks benchmark (decision gate)', () => {
  it('measures full-rebuild p95 at 100x100 and reports the number', () => {
    const iterations = 25;
    const result = benchmarkBuildChunks(100, 100, iterations);

    console.log(
      `[buildChunks benchmark] 100x100: p95=${result.p95.toFixed(3)}ms over ${iterations} iterations, ${result.chunkCount} chunks`,
    );

    expect(result.samplesMs).toHaveLength(iterations);
    expect(result.samplesMs.every((sample) => Number.isFinite(sample) && sample >= 0)).toBe(true);
    expect(Number.isFinite(result.p95)).toBe(true);
    expect(result.chunkCount).toBeGreaterThan(0);
  });

  it('measures full-rebuild p95 at 512x512 and reports the number', () => {
    const iterations = 10;
    const result = benchmarkBuildChunks(512, 512, iterations);

    console.log(
      `[buildChunks benchmark] 512x512: p95=${result.p95.toFixed(3)}ms over ${iterations} iterations, ${result.chunkCount} chunks`,
    );

    expect(result.samplesMs).toHaveLength(iterations);
    expect(result.samplesMs.every((sample) => Number.isFinite(sample) && sample >= 0)).toBe(true);
    expect(Number.isFinite(result.p95)).toBe(true);
    expect(result.chunkCount).toBe(32 * 32);
  });
});
