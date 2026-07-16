/**
 * `isAuthoredResultPlayable` (rpgm-whole-game-import boot-resilience fix,
 * post-deploy regression): a real RPG Maker project's very first map
 * (lowest mapId) is very often an unused/placeholder map with an
 * impassable-everywhere overlay tile on an upper layer -- `main.ts`'s
 * manifest boot chain must detect this BEFORE ever constructing a
 * `THREE.WebGPURenderer` for it, so it can skip to the next manifest map
 * instead of leaving the app on a dead, unrenderable candidate.
 *
 * Reproduces the exact real-world shape found in kingdom-of-subversion's
 * map001.tmmap.json: tile layer index 1 (the layer BELOW the top, ABOVE
 * ground) is populated everywhere with one non-star tile id whose flags
 * block all 4 directions -- `computeDecisiveFlags` (passability-grid.ts)
 * picks that tile as decisive for every cell (layers are read top-down,
 * index 1 before index 0), so `PassabilityGrid.isStandable` is false
 * everywhere and `resolveInitialSpawn`'s `findSpawnTile` throws.
 */
import type { RpgmMap, RpgmTileset, TileSheetNames } from '@threemaker/importer-rpgm';
import { describe, expect, it } from 'vitest';
import type { AuthoredMapResult } from '../src/authored-map.js';
import type { FloorSource } from '../src/floor-runtime.js';
import { isAuthoredResultPlayable } from '../src/map-playability.js';

const EMPTY_SHEET_NAMES: TileSheetNames = {
  A1: '',
  A2: '',
  A3: '',
  A4: '',
  A5: '',
  B: '',
  C: '',
  D: '',
  E: '',
};

const SIZE = 3;

function buildResult(overlayTileId: number | null): AuthoredMapResult {
  const cellCount = SIZE * SIZE;
  const groundLayer = new Array(cellCount).fill(2); // tile id 2: fully passable ground
  const overlayLayer =
    overlayTileId === null
      ? new Array(cellCount).fill(0)
      : new Array(cellCount).fill(overlayTileId);

  const map: RpgmMap = {
    id: 1,
    displayName: '',
    width: SIZE,
    height: SIZE,
    tilesetId: 1,
    scrollType: 0,
    layers: {
      tileLayers: [
        groundLayer,
        overlayLayer,
        new Array(cellCount).fill(0),
        new Array(cellCount).fill(0),
      ],
      shadows: new Array(cellCount).fill(0),
      regions: new Array(cellCount).fill(0),
    },
  };

  const flags = new Array(8192).fill(0);
  // tile id 2 (ground): flags stay 0 -- fully passable.
  if (overlayTileId !== null) {
    flags[overlayTileId] = 0xf; // impassable in all 4 directions, no star bit.
  }

  const tileset: RpgmTileset = { id: 1, name: 'Test', sheetNames: EMPTY_SHEET_NAMES, flags };

  const floorSource: FloorSource = {
    floorId: 'floor-0',
    baseElevation: 0,
    map,
    tileset,
    textures: {},
    sheetPixelSizes: {},
  };

  return { floorSources: [floorSource], stairLinks: [], spawn: undefined };
}

describe('isAuthoredResultPlayable', () => {
  it('returns true for a map with at least one standable tile', () => {
    expect(isAuthoredResultPlayable(buildResult(null))).toBe(true);
  });

  it('returns false when a non-star overlay tile blocks all 4 directions on every cell (real-world regression: an unused RPGM Map001)', () => {
    expect(isAuthoredResultPlayable(buildResult(4208))).toBe(false);
  });

  it('returns false when the result has no floor sources at all', () => {
    expect(isAuthoredResultPlayable({ floorSources: [], stairLinks: [], spawn: undefined })).toBe(
      false,
    );
  });
});
