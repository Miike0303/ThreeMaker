import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RpgmTileset } from '@threemaker/importer-rpgm';
import { parseTilesets } from '@threemaker/importer-rpgm';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateSyntheticMap } from '../src/dev/synthetic-map.js';
import { buildChunks } from '../src/geometry/chunk-geometry.js';
import { DEFAULT_CHUNK_SIZE, type SheetPixelSizes } from '../src/geometry/types.js';
import { StreamingTilemapScene } from '../src/scene/streaming-tilemap-scene.js';
import { ChunkStreamer } from '../src/streaming/chunk-streamer.js';
import { ROSELIAM_FIXTURE_DIR, requireFixture } from './fixture-path.js';

// Standard MV/MZ sheet pixel dimensions for the sheets the synthetic map
// uses; only the aspect math matters here, not real image contents.
const SHEET_SIZES: SheetPixelSizes = {
  A2: { width: 768, height: 576 },
  A4: { width: 768, height: 720 },
  B: { width: 768, height: 768 },
};

describe('streaming a giant synthetic map (real Roseliam Dungeon tileset)', () => {
  let tileset: RpgmTileset;

  beforeAll(async () => {
    requireFixture(ROSELIAM_FIXTURE_DIR);
    const contents = await readFile(join(ROSELIAM_FIXTURE_DIR, 'Tilesets.json'), 'utf8');
    const tilesets = parseTilesets(JSON.parse(contents));
    const found = tilesets.find((entry) => entry.id === 4);
    if (!found) throw new Error('Roseliam Dungeon tileset (id 4) missing from fixture.');
    tileset = found;
  });

  it('keeps live GPU chunks bounded on a 512x512 map exactly like on a Map007-sized one', () => {
    const map = generateSyntheticMap({ width: 512, height: 512, seed: 9 });
    const chunks = buildChunks(map, tileset, SHEET_SIZES);

    // A 512x512 map is a 32x32 chunk grid: over a thousand chunks of data...
    expect(chunks.length).toBe(32 * 32);

    const scene = new StreamingTilemapScene(chunks, { B: new THREE.Texture() });
    const streamer = new ChunkStreamer({
      chunkSize: DEFAULT_CHUNK_SIZE,
      mapWidth: map.width,
      mapHeight: map.height,
      buildRadius: 2,
      disposeRadius: 3,
    });

    // ...but walking the whole diagonal never keeps more than the
    // dispose-radius square alive, same ceiling a tiny map would have.
    const bound = (2 * 3 + 1) ** 2;
    for (let step = 0; step < 512; step += 5) {
      scene.applyDiff(streamer.update(step, step));
      expect(scene.liveChunkCount).toBeLessThanOrEqual(bound);
      expect(scene.liveChunkCount).toBe(streamer.liveCount);
    }

    // After the walk, far-behind chunks were disposed, not accumulated.
    expect(scene.liveChunkCount).toBeLessThanOrEqual(bound);
    scene.dispose();
  });

  it('walking 20+ tiles in one direction disposes the chunks left behind', () => {
    const map = generateSyntheticMap({ width: 512, height: 512, seed: 9 });
    const chunks = buildChunks(map, tileset, SHEET_SIZES);
    const scene = new StreamingTilemapScene(chunks, { B: new THREE.Texture() });
    const streamer = new ChunkStreamer({
      chunkSize: DEFAULT_CHUNK_SIZE,
      mapWidth: map.width,
      mapHeight: map.height,
      buildRadius: 2,
      disposeRadius: 3,
    });

    scene.applyDiff(streamer.update(256, 256));
    const before = scene.liveChunkCount;
    expect(before).toBe(25);

    // Walk 112 tiles east, tile by tile, tracking every disposed key.
    const disposed: string[] = [];
    for (let x = 257; x <= 368; x++) {
      const diff = streamer.update(x, 256);
      disposed.push(...diff.toDispose);
      scene.applyDiff(diff);
    }

    expect(disposed.length).toBeGreaterThan(0);
    expect(disposed).toContain('14,16'); // the starting west edge is long gone
    // Steady state while walking: the 5x5 build square plus one trailing
    // column kept by hysteresis (disposeRadius = buildRadius + 1) -- bounded,
    // not growing with distance walked.
    expect(scene.liveChunkCount).toBe(30);
    scene.dispose();
  });
});
