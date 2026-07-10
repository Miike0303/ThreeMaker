import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMap, parseTilesets } from '@threemaker/importer-rpgm';
import { beforeAll, describe, expect, it } from 'vitest';
import { PassabilityGrid } from '../src/passability-grid.js';
import { MZ_PROJECT1_FIXTURE_DIR, requireFixture } from './fixture-path.js';

async function readJson(fileName: string): Promise<unknown> {
  const contents = await readFile(join(MZ_PROJECT1_FIXTURE_DIR, 'data', fileName), 'utf8');
  return JSON.parse(contents);
}

describe('PassabilityGrid against the real mz-project1 fixture (Map001)', () => {
  beforeAll(() => {
    requireFixture(MZ_PROJECT1_FIXTURE_DIR);
  });

  it('finds at least one standable tile on Map001', async () => {
    const map = parseMap(await readJson('Map001.json'), 1);
    const tilesets = parseTilesets(await readJson('Tilesets.json'));
    const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
    expect(tileset, `tileset ${map.tilesetId} for Map001 should exist`).toBeDefined();
    if (!tileset) return;

    const grid = new PassabilityGrid(map, tileset);

    let standableCount = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (grid.isStandable(x, y)) standableCount++;
      }
    }

    expect(standableCount).toBeGreaterThan(0);
  });

  it('reports an out-of-bounds query as blocked/impassable rather than throwing', async () => {
    const map = parseMap(await readJson('Map001.json'), 1);
    const tilesets = parseTilesets(await readJson('Tilesets.json'));
    const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
    if (!tileset) return;

    const grid = new PassabilityGrid(map, tileset);

    expect(() => grid.isStandable(-1, -1)).not.toThrow();
    expect(grid.isStandable(-1, -1)).toBe(false);
    expect(grid.isStandable(map.width, map.height)).toBe(false);
    expect(() => grid.canMove(-1, -1, 'right')).not.toThrow();
    expect(grid.canMove(-1, -1, 'right')).toBe(false);
  });
});
