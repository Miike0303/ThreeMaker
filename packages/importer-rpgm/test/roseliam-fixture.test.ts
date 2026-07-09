import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject } from '../src/load-project.js';
import { parseMapInfos } from '../src/parse-map-infos.js';
import { parseTilesets } from '../src/parse-tilesets.js';
import { decodeTileFlags } from '../src/tile-flags.js';
import type { RpgmProject } from '../src/types.js';
import { ROSELIAM_FIXTURE_DIR, requireFixture } from './fixture-path.js';

// Ground truth, read directly from the maps picked for this fixture
// (see fixtures/README.md): id -> [width, height, tilesetId].
const EXPECTED_MAPS: Record<number, { width: number; height: number; tilesetId: number }> = {
  7: { width: 20, height: 23, tilesetId: 4 },
  21: { width: 15, height: 11, tilesetId: 3 },
  24: { width: 11, height: 8, tilesetId: 10 },
};

async function readJson(fileName: string): Promise<unknown> {
  const contents = await readFile(join(ROSELIAM_FIXTURE_DIR, fileName), 'utf8');
  return JSON.parse(contents);
}

describe('Roseliam fixture (real RPG Maker MV project data)', () => {
  beforeAll(() => {
    requireFixture(ROSELIAM_FIXTURE_DIR);
  });

  it('parseMapInfos yields real, non-empty map names', async () => {
    const mapInfos = parseMapInfos(await readJson('MapInfos.json'));

    expect(mapInfos.length).toBeGreaterThan(0);
    for (const info of mapInfos) {
      expect(info.name.length).toBeGreaterThan(0);
    }
    // Map id 1 is the game's starting town in this fixture's map tree.
    expect(mapInfos.find((info) => info.id === 1)?.name).toBe('市街');
  });

  it('parseTilesets yields a flags array for every tileset (length varies: unused tilesets are truncated)', async () => {
    const tilesets = parseTilesets(await readJson('Tilesets.json'));

    expect(tilesets.length).toBeGreaterThan(0);
    for (const tileset of tilesets) {
      // The documented format implies a fixed 8192-entry flags array (one
      // per tile id), but real, unused/placeholder tilesets in this fixture
      // are serialized with a truncated array (as short as length 1) — the
      // editor only persists flags up to the highest tile actually painted.
      // Consumers must index defensively (see `decodeTileFlags(flags[id] ?? 0)`).
      expect(tileset.flags.length).toBeGreaterThan(0);
    }

    // At least one real, in-use tileset does have the full documented length.
    const fullyPopulated = tilesets.filter((tileset) => tileset.flags.length === 8192);
    expect(fullyPopulated.length).toBeGreaterThan(0);
    const nonEmptySheets = Object.values(fullyPopulated[0]?.sheetNames ?? {}).filter(
      (name) => name.length > 0,
    );
    expect(nonEmptySheets.length).toBeGreaterThan(0);
  });

  it('loadProject auto-detects the flat fixture layout and loads exactly the 3 fixture maps', async () => {
    const project: RpgmProject = await loadProject(ROSELIAM_FIXTURE_DIR);

    expect(project.mapInfos.length).toBeGreaterThan(0);
    expect(project.tilesets.length).toBeGreaterThan(0);
    expect(project.maps.size).toBe(3);
    expect([...project.maps.keys()].sort((a, b) => a - b)).toEqual([7, 21, 24]);
  });

  it('each loaded map matches its real width/height/tilesetId and the width*height*6 data invariant', async () => {
    const project = await loadProject(ROSELIAM_FIXTURE_DIR);

    for (const [id, expected] of Object.entries(EXPECTED_MAPS)) {
      const map = project.maps.get(Number(id));
      expect(map, `map ${id} should have loaded`).toBeDefined();
      if (!map) continue;

      expect(map.width).toBe(expected.width);
      expect(map.height).toBe(expected.height);
      expect(map.tilesetId).toBe(expected.tilesetId);

      const size = expected.width * expected.height;
      for (const layer of map.layers.tileLayers) {
        expect(layer).toHaveLength(size);
      }
      expect(map.layers.shadows).toHaveLength(size);
      expect(map.layers.regions).toHaveLength(size);
    }
  });

  it('finds at least one upper-layer (star bit) tile across the fixture maps, decoded via the matching tileset', async () => {
    const project = await loadProject(ROSELIAM_FIXTURE_DIR);
    const tilesetsById = new Map(project.tilesets.map((tileset) => [tileset.id, tileset]));

    let upperLayerTileCount = 0;
    for (const map of project.maps.values()) {
      const tileset = tilesetsById.get(map.tilesetId);
      expect(tileset, `tileset ${map.tilesetId} for map ${map.id} should exist`).toBeDefined();
      if (!tileset) continue;

      for (const layer of map.layers.tileLayers) {
        for (const tileId of layer) {
          if (tileId === 0) continue;
          const flags = tileset.flags[tileId] ?? 0;
          if (decodeTileFlags(flags).isUpperLayer) upperLayerTileCount++;
        }
      }
    }

    // Map 021 and Map 007 in this fixture are known to contain star-flagged tiles.
    expect(upperLayerTileCount).toBeGreaterThan(0);
  });

  it('finds at least one impassable tile across the fixture maps', async () => {
    const project = await loadProject(ROSELIAM_FIXTURE_DIR);
    const tilesetsById = new Map(project.tilesets.map((tileset) => [tileset.id, tileset]));

    let impassableTileCount = 0;
    for (const map of project.maps.values()) {
      const tileset = tilesetsById.get(map.tilesetId);
      if (!tileset) continue;

      for (const layer of map.layers.tileLayers) {
        for (const tileId of layer) {
          if (tileId === 0) continue;
          const flags = decodeTileFlags(tileset.flags[tileId] ?? 0);
          if (
            flags.impassableDown ||
            flags.impassableLeft ||
            flags.impassableRight ||
            flags.impassableUp
          ) {
            impassableTileCount++;
          }
        }
      }
    }

    expect(impassableTileCount).toBeGreaterThan(0);
  });
});
