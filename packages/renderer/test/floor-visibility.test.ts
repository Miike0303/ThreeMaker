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
import type { FloorVisibilityPolicy } from '../src/streaming/floor-visibility.js';
import { WindowedFloorPolicy } from '../src/streaming/floor-visibility.js';
import { ROSELIAM_FIXTURE_DIR, requireFixture } from './fixture-path.js';

describe('WindowedFloorPolicy', () => {
  const policy = new WindowedFloorPolicy();

  it('renders only floor 0 when the building has one floor', () => {
    expect(policy.visibleFloors(0, 1)).toEqual([0]);
  });

  it('renders floor 0 and floor 1 when current floor is 1', () => {
    expect(policy.visibleFloors(1, 2)).toEqual([0, 1]);
  });

  it('renders floor 1 and floor 2 when current floor is 2 in a 3-floor building', () => {
    expect(policy.visibleFloors(2, 3)).toEqual([1, 2]);
  });

  it('never renders currentFloor + 1, even when it exists', () => {
    expect(policy.visibleFloors(0, 3)).toEqual([0]);
    expect(policy.visibleFloors(1, 3)).toEqual([0, 1]);
  });

  it('omits currentFloor - 1 when it would be negative (no floor below ground)', () => {
    expect(policy.visibleFloors(0, 5)).toEqual([0]);
  });

  it('is swappable behind the FloorVisibilityPolicy interface (change 3 substitutes an occlusion policy)', () => {
    const showEverything: FloorVisibilityPolicy = {
      visibleFloors: (_current, floorCount) => Array.from({ length: floorCount }, (_, i) => i),
    };
    expect(showEverything.visibleFloors(0, 3)).toEqual([0, 1, 2]);
  });
});

// Standard MV/MZ sheet pixel dimensions matching the Roseliam Dungeon
// tileset -- only the aspect math matters for chunk geometry, not real image
// contents (same convention as giant-map-streaming.test.ts).
const SHEET_SIZES: SheetPixelSizes = {
  A2: { width: 768, height: 576 },
  A4: { width: 768, height: 720 },
  B: { width: 768, height: 768 },
};

describe('floor-rendering-window streaming-budget guard', () => {
  let tileset: RpgmTileset;

  beforeAll(async () => {
    requireFixture(ROSELIAM_FIXTURE_DIR);
    const contents = await readFile(join(ROSELIAM_FIXTURE_DIR, 'Tilesets.json'), 'utf8');
    const tilesets = parseTilesets(JSON.parse(contents));
    const found = tilesets.find((entry) => entry.id === 4);
    if (!found) throw new Error('Roseliam Dungeon tileset (id 4) missing from fixture.');
    tileset = found;
  });

  /** Builds one floor's { tilemap, streamer } pair, mirroring main.ts's per-floor wiring. */
  function buildFloorRender(seed: number) {
    const map = generateSyntheticMap({ width: 128, height: 128, seed });
    const chunks = buildChunks(map, tileset, SHEET_SIZES);
    const tilemap = new StreamingTilemapScene(chunks, { B: new THREE.Texture() });
    const streamer = new ChunkStreamer({
      chunkSize: DEFAULT_CHUNK_SIZE,
      mapWidth: map.width,
      mapHeight: map.height,
      buildRadius: 2,
      disposeRadius: 3,
    });
    return { tilemap, streamer };
  }

  it('total live chunks across the visible window never exceeds window(2) x single-floor streamer bound', () => {
    const policy = new WindowedFloorPolicy();
    const floorCount = 2;
    const floors = [buildFloorRender(1), buildFloorRender(2)];
    const singleFloorBound = (2 * 3 + 1) ** 2; // (2*disposeRadius+1)**2, disposeRadius=3

    function applyWindow(currentFloor: number, focusX: number, focusY: number): void {
      const visible = new Set(policy.visibleFloors(currentFloor, floorCount));
      for (let i = 0; i < floors.length; i++) {
        const floor = floors[i];
        if (!floor) continue;
        if (visible.has(i)) floor.tilemap.applyDiff(floor.streamer.update(focusX, focusY));
      }
    }

    function totalLiveChunks(): number {
      return floors.reduce((sum, floor) => sum + (floor?.tilemap.liveChunkCount ?? 0), 0);
    }

    // currentFloor = 0: window = [0] only -- floor 1 must stay untouched/empty.
    applyWindow(0, 64, 64);
    expect(totalLiveChunks()).toBeLessThanOrEqual(singleFloorBound);
    expect(floors[1]?.tilemap.liveChunkCount).toBe(0);

    // currentFloor = 1: window = [0, 1] -- both floors may now be live, but the
    // total is still bounded by exactly 2 single-floor budgets, never more
    // (this is the "window(2) x streamer bound" guard).
    applyWindow(1, 64, 64);
    expect(totalLiveChunks()).toBeLessThanOrEqual(2 * singleFloorBound);

    for (const floor of floors) floor?.tilemap.dispose();
  });
});
