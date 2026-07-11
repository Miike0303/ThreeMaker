import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeHeightGrid, heightForRegion } from '../src/elevation.js';
import { parseMap } from '../src/parse-map.js';
import type { RpgmMap } from '../src/types.js';
import { MZ_PROJECT1_FIXTURE_DIR, requireFixture } from './fixture-path.js';

async function readJson(fileName: string): Promise<unknown> {
  const contents = await readFile(join(MZ_PROJECT1_FIXTURE_DIR, 'data', fileName), 'utf8');
  return JSON.parse(contents);
}

function buildMap(width: number, height: number, regions: readonly number[]): RpgmMap {
  const size = width * height;
  const empty = new Array(size).fill(0);
  return {
    id: 1,
    displayName: 'synthetic',
    width,
    height,
    tilesetId: 1,
    scrollType: 0,
    layers: {
      tileLayers: [empty, empty, empty, empty],
      shadows: empty,
      regions,
    },
  };
}

describe('heightForRegion', () => {
  it('maps region ids 1-7 to the same height, per the MV3D convention', () => {
    for (let region = 1; region <= 7; region++) {
      expect(heightForRegion(region)).toBe(region);
    }
  });

  it('treats region 0 (unpainted) as ground level', () => {
    expect(heightForRegion(0)).toBe(0);
  });

  it('treats region ids outside 1-7 (free-form plugin regions) as ground level', () => {
    expect(heightForRegion(8)).toBe(0);
    expect(heightForRegion(63)).toBe(0);
    expect(heightForRegion(255)).toBe(0);
  });
});

describe('computeHeightGrid', () => {
  it('produces a row-major grid matching heightForRegion for every cell', () => {
    const regions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 200];
    const map = buildMap(10, 1, regions);

    const grid = computeHeightGrid(map);

    expect(Array.from(grid)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 0]);
  });

  it('reproduces the real mz-project1 fixture painted hill (ring=1, inside=2, peak=3)', async () => {
    requireFixture(MZ_PROJECT1_FIXTURE_DIR);
    const map = parseMap(await readJson('Map001.json'), 1);

    const grid = computeHeightGrid(map);
    const at = (x: number, y: number) => grid[y * map.width + x];

    // Outside the painted hill: ground level.
    expect(at(0, 0)).toBe(0);
    expect(at(8, 4)).toBe(0);

    // Ring (region 1): the border of the hill, rows 2-7 cols 9-14.
    expect(at(9, 2)).toBe(1);
    expect(at(14, 7)).toBe(1);

    // Inside the ring (region 2).
    expect(at(10, 3)).toBe(2);
    expect(at(13, 6)).toBe(2);

    // Peak (region 3): rows 4-5, cols 11-12.
    expect(at(11, 4)).toBe(3);
    expect(at(12, 5)).toBe(3);
  });
});
