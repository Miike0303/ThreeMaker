import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RpgmTileset, TileSheetId } from '@threemaker/importer-rpgm';
import { parseMap, parseTilesets } from '@threemaker/importer-rpgm';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildChunks } from '../src/geometry/chunk-geometry.js';
import type { SheetPixelSizes } from '../src/geometry/types.js';
import { ROSELIAM_FIXTURE_DIR, ROSELIAM_TILESETS_IMG_DIR, requireFixture } from './fixture-path.js';
import { readPngSize } from './read-png-size.js';

async function readJson(fileName: string): Promise<unknown> {
  const contents = await readFile(join(ROSELIAM_FIXTURE_DIR, fileName), 'utf8');
  return JSON.parse(contents);
}

/** Loads the pixel size of every non-empty sheet image a tileset references. */
async function loadSheetPixelSizes(tileset: RpgmTileset): Promise<SheetPixelSizes> {
  const sizes: SheetPixelSizes = {};
  for (const [sheet, imageName] of Object.entries(tileset.sheetNames) as [TileSheetId, string][]) {
    if (!imageName) continue;
    sizes[sheet] = await readPngSize(join(ROSELIAM_TILESETS_IMG_DIR, `${imageName}.png`));
  }
  return sizes;
}

describe('buildChunks on the real Roseliam fixture (Map007)', () => {
  beforeAll(() => {
    requireFixture(ROSELIAM_FIXTURE_DIR);
    requireFixture(ROSELIAM_TILESETS_IMG_DIR);
  });

  it('produces render-ready chunks with a low (chunk, sheet) draw-call count', async () => {
    const mapJson = await readJson('Map007.json');
    const tilesetsJson = await readJson('Tilesets.json');

    const map = parseMap(mapJson, 7);
    const tilesets = parseTilesets(tilesetsJson);
    const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
    expect(tileset, `tileset ${map.tilesetId} for Map007 should exist`).toBeDefined();
    if (!tileset) return;

    const sheetPixelSizes = await loadSheetPixelSizes(tileset);

    const chunks = buildChunks(map, tileset, sheetPixelSizes);

    expect(chunks.length).toBeGreaterThan(0);

    let tileCount = 0;
    let upperLayerCount = 0;
    const drawCallKeys = new Set<string>();
    for (const chunk of chunks) {
      for (const tile of chunk.tiles) {
        tileCount++;
        if (tile.elevation === 'upper') upperLayerCount++;
        drawCallKeys.add(`${chunk.chunkX},${chunk.chunkY},${tile.sheet}`);
      }
    }

    expect(tileCount).toBeGreaterThan(0);
    // Map007 is 20x23 -- known (from importer-rpgm's own fixture test) to
    // contain at least one upper-layer/star tile.
    expect(upperLayerCount).toBeGreaterThan(0);
    // Draw-call proxy: one merged mesh per (chunk, sheet) pair. 20x23 tiles
    // with a 16x16 chunk size is at most a 2x2 chunk grid, so this should sit
    // far below the "well under 20 draw calls for a typical map" target.
    expect(drawCallKeys.size).toBeLessThan(20);
  });
});
