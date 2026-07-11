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

  describe('elevation-aware movement on the painted hill (region 1 ring / 2 inside / 3 peak)', () => {
    it('blocks stepping from flat ground onto the region-1 ring (a 1-tile-high cliff)', async () => {
      const map = parseMap(await readJson('Map001.json'), 1);
      const tilesets = parseTilesets(await readJson('Tilesets.json'));
      const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
      expect(tileset).toBeDefined();
      if (!tileset) return;

      const grid = new PassabilityGrid(map, tileset);

      // (9,1) is flat ground just north of the ring's (9,2) tile.
      expect(grid.elevationAt(9, 1)).toBe(0);
      expect(grid.elevationAt(9, 2)).toBe(1);
      expect(grid.canMove(9, 1, 'down')).toBe(false);
      expect(grid.canMove(9, 2, 'up')).toBe(false);
    });

    it('blocks stepping from the ring up onto the inside terrace, and from the terrace up onto the peak', async () => {
      const map = parseMap(await readJson('Map001.json'), 1);
      const tilesets = parseTilesets(await readJson('Tilesets.json'));
      const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
      expect(tileset).toBeDefined();
      if (!tileset) return;

      const grid = new PassabilityGrid(map, tileset);

      // Ring (10,2, height 1) -> inside terrace (10,3, height 2): blocked.
      expect(grid.elevationAt(10, 2)).toBe(1);
      expect(grid.elevationAt(10, 3)).toBe(2);
      expect(grid.canMove(10, 2, 'down')).toBe(false);

      // Terrace (11,3, height 2) -> peak (11,4, height 3): blocked.
      expect(grid.elevationAt(11, 3)).toBe(2);
      expect(grid.elevationAt(11, 4)).toBe(3);
      expect(grid.canMove(11, 3, 'down')).toBe(false);
    });

    it('allows movement between same-height tiles within a terrace', async () => {
      const map = parseMap(await readJson('Map001.json'), 1);
      const tilesets = parseTilesets(await readJson('Tilesets.json'));
      const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
      expect(tileset).toBeDefined();
      if (!tileset) return;

      const grid = new PassabilityGrid(map, tileset);

      // Both peak tiles (11,4) and (12,4) are region 3 -- same height.
      expect(grid.elevationAt(11, 4)).toBe(3);
      expect(grid.elevationAt(12, 4)).toBe(3);
      expect(grid.canMove(11, 4, 'right')).toBe(true);

      // Both flat-ground tiles far from the hill stay open.
      expect(grid.canMove(0, 0, 'right')).toBe(true);
    });
  });
});
