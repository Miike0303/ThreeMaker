import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject } from '../src/load-project.js';
import { parseTilesets } from '../src/parse-tilesets.js';
import { decodeTileFlags } from '../src/tile-flags.js';
import { getAutotileKind, isAutotile } from '../src/tile-id.js';
import type { RpgmProject } from '../src/types.js';
import { MZ_PROJECT1_FIXTURE_DIR, requireFixture } from './fixture-path.js';

async function readJson(fileName: string): Promise<unknown> {
  const contents = await readFile(join(MZ_PROJECT1_FIXTURE_DIR, 'data', fileName), 'utf8');
  return JSON.parse(contents);
}

describe('mz-project1 fixture (real RPG Maker MZ project data, dir/data layout)', () => {
  beforeAll(() => {
    requireFixture(MZ_PROJECT1_FIXTURE_DIR);
  });

  it('loadProject auto-detects the dir/data layout and loads Map001', async () => {
    const project: RpgmProject = await loadProject(MZ_PROJECT1_FIXTURE_DIR);

    expect(project.mapInfos.length).toBeGreaterThan(0);
    expect(project.tilesets.length).toBeGreaterThan(0);
    expect(project.maps.size).toBe(1);
    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('Map001 matches its real width/height and the width*height*6 data invariant', async () => {
    const project = await loadProject(MZ_PROJECT1_FIXTURE_DIR);
    const map = project.maps.get(1);
    expect(map).toBeDefined();
    if (!map) return;

    expect(map.width).toBe(17);
    expect(map.height).toBe(13);
    expect(map.tilesetId).toBe(1);

    const size = map.width * map.height;
    for (const layer of map.layers.tileLayers) {
      expect(layer).toHaveLength(size);
    }
    expect(map.layers.shadows).toHaveLength(size);
    expect(map.layers.regions).toHaveLength(size);
  });

  it('decodes the real flags array for every tileset without throwing', async () => {
    const tilesets = parseTilesets(await readJson('Tilesets.json'));
    expect(tilesets.length).toBeGreaterThan(0);

    for (const tileset of tilesets) {
      expect(tileset.flags.length).toBeGreaterThan(0);
      for (let id = 0; id < tileset.flags.length; id++) {
        expect(() => decodeTileFlags(tileset.flags[id] ?? 0)).not.toThrow();
      }
    }
  });

  it('finds at least one autotile tile id in Map001, decodable via isAutotile/getAutotileKind', async () => {
    const project = await loadProject(MZ_PROJECT1_FIXTURE_DIR);
    const map = project.maps.get(1);
    expect(map).toBeDefined();
    if (!map) return;

    let autotileCount = 0;
    for (const layer of map.layers.tileLayers) {
      for (const tileId of layer) {
        if (tileId === 0) continue;
        if (isAutotile(tileId)) {
          autotileCount++;
          expect(getAutotileKind(tileId)).toBeGreaterThanOrEqual(0);
        }
      }
    }

    expect(autotileCount).toBeGreaterThan(0);
  });
});
