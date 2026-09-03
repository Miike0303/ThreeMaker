/**
 * Pins the blank-floor live-paint recipe in PainterViewport.
 *
 * StreamingTilemapScene.patchChunks stores ChunkBuildData but does not build
 * chunks that are not yet live. A from-scratch blank map starts with zero
 * live chunks, so applyDiffLiveUpdate must patchChunks then buildChunk —
 * otherwise the first brush stroke is invisible. Cleared dirty keys must
 * still push tiles: [] so erase does not leave ghost meshes.
 *
 * Scene-level behavior is covered in streaming-tilemap-scene.test.ts; this
 * file reads the viewport source so deleting the buildChunk loop fails here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const VIEWPORT_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/painter-viewport.ts'),
  'utf8',
);

describe('PainterViewport blank-floor live-paint source pin', () => {
  it('applyDiffLiveUpdate patches then builds, and clears empty dirty keys', () => {
    expect(VIEWPORT_SOURCE).toContain('this.tilemap.patchChunks(patched)');
    expect(VIEWPORT_SOURCE).toContain(
      'for (const chunk of patched) this.tilemap.buildChunk(chunkKey(chunk.chunkX, chunk.chunkY))',
    );
    expect(VIEWPORT_SOURCE).toContain('tiles: []');
    expect(VIEWPORT_SOURCE).toMatch(/cleared\.push\(\{\s*chunkX:[\s\S]*?tiles:\s*\[\]/);
  });
});
