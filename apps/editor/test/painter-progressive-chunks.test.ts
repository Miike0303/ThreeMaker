/**
 * Pins progressive GPU chunk builds on painter load / floor switch: CPU data
 * is built up front, but `buildChunk` is queued and drained per frame instead
 * of a sync loop over every chunk.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const VIEWPORT_SOURCE = readFileSync(join(SRC, 'painter-viewport.ts'), 'utf8');

describe('PainterViewport progressive chunk build source pin', () => {
  it('queues pendingChunkKeys on rebuild and drains them in the render loop', () => {
    expect(VIEWPORT_SOURCE).toMatch(/pendingChunkKeys/);
    expect(VIEWPORT_SOURCE).toMatch(/drainProgressiveChunkBuilds/);
    expect(VIEWPORT_SOURCE).toMatch(/PROGRESSIVE_CHUNK_BUILDS_PER_FRAME/);
    // Must not sync-build every chunk in rebuildActiveFloorScene.
    expect(VIEWPORT_SOURCE).not.toMatch(
      /for \(const chunk of chunks\) this\.tilemap\.buildChunk\(chunkKey/,
    );
    // Live paint still force-builds dirty keys immediately.
    expect(VIEWPORT_SOURCE).toMatch(
      /for \(const chunk of patched\) this\.tilemap\.buildChunk\(chunkKey/,
    );
    expect(VIEWPORT_SOURCE).toMatch(/this\.drainProgressiveChunkBuilds\(\)/);
  });
});
