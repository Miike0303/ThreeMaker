import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMap, parseTilesets } from '@threemaker/importer-rpgm';
import { beforeAll, describe, expect, it } from 'vitest';
import { PassabilityGrid } from '../src/passability-grid.js';
import { ROSELIAM_FIXTURE_DIR, requireFixture } from './fixture-path.js';

async function readJson(fileName: string): Promise<unknown> {
  const contents = await readFile(join(ROSELIAM_FIXTURE_DIR, fileName), 'utf8');
  return JSON.parse(contents);
}

// Ground truth for Map007 (20x23, dungeon interior, tileset id 4), found by
// decoding the real fixture data directly: (7,4)/(8,4) are open dungeon
// floor tiles (sheet A2), while (12,3) is a fully-impassable A4 wall tile
// (id 6329, all four directional bits set) directly east of the open floor
// tile (11,3).
describe('PassabilityGrid against the real Roseliam fixture (Map007)', () => {
  beforeAll(() => {
    requireFixture(ROSELIAM_FIXTURE_DIR);
  });

  it('lets the player walk across open floor tiles', async () => {
    const map = parseMap(await readJson('Map007.json'), 7);
    const tilesets = parseTilesets(await readJson('Tilesets.json'));
    const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
    expect(tileset, `tileset ${map.tilesetId} for Map007 should exist`).toBeDefined();
    if (!tileset) return;

    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(7, 4, 'right')).toBe(true);
    expect(grid.canMove(8, 4, 'left')).toBe(true);
    expect(grid.isStandable(7, 4)).toBe(true);
    expect(grid.isStandable(8, 4)).toBe(true);
  });

  it('blocks the player from walking into a wall tile', async () => {
    const map = parseMap(await readJson('Map007.json'), 7);
    const tilesets = parseTilesets(await readJson('Tilesets.json'));
    const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
    if (!tileset) return;

    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(11, 3, 'right')).toBe(false);
    expect(grid.isStandable(12, 3)).toBe(false);
  });

  it('finds at least one movable and one blocked transition across the whole map', async () => {
    const map = parseMap(await readJson('Map007.json'), 7);
    const tilesets = parseTilesets(await readJson('Tilesets.json'));
    const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
    if (!tileset) return;

    const grid = new PassabilityGrid(map, tileset);
    const directions = ['down', 'left', 'right', 'up'] as const;

    let movable = 0;
    let blocked = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        for (const direction of directions) {
          if (grid.canMove(x, y, direction)) movable++;
          else blocked++;
        }
      }
    }

    expect(movable).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
  });
});
