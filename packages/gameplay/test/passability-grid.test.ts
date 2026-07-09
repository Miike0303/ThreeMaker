import type { RpgmMap, RpgmMapLayers, RpgmTileset, TileLayer } from '@threemaker/importer-rpgm';
import { describe, expect, it } from 'vitest';
import { PassabilityGrid } from '../src/passability-grid.js';

// Raw flag bits, mirroring importer-rpgm's tile-flags.ts (kept as plain
// numbers here so this test doesn't depend on that module's internals,
// only its documented bit layout).
const IMPASSABLE_DOWN = 0x1;
const IMPASSABLE_LEFT = 0x2;
const IMPASSABLE_RIGHT = 0x4;
const IMPASSABLE_UP = 0x8;
const STAR_UPPER_LAYER = 0x10;

/** Builds a minimal synthetic `RpgmMap`. `layer0`/`layer3` are row-major, length width*height; omitted layers are all-zero (empty). */
function buildMap(
  width: number,
  height: number,
  layerOverrides: Partial<Record<0 | 1 | 2 | 3, TileLayer>> = {},
): RpgmMap {
  const size = width * height;
  const zeros: TileLayer = new Array(size).fill(0);
  const tileLayers: RpgmMapLayers['tileLayers'] = [
    layerOverrides[0] ?? zeros,
    layerOverrides[1] ?? zeros,
    layerOverrides[2] ?? zeros,
    layerOverrides[3] ?? zeros,
  ];

  return {
    id: 1,
    displayName: 'synthetic',
    width,
    height,
    tilesetId: 1,
    scrollType: 0,
    layers: { tileLayers, shadows: zeros, regions: zeros },
  };
}

/** Builds a minimal synthetic `RpgmTileset`. `flags` is a sparse map of tile id -> raw flag bits. */
function buildTileset(flags: Record<number, number>): RpgmTileset {
  const maxId = Math.max(0, ...Object.keys(flags).map(Number));
  const flagArray = new Array(maxId + 1).fill(0);
  for (const [id, value] of Object.entries(flags)) flagArray[Number(id)] = value;

  return {
    id: 1,
    name: 'synthetic',
    sheetNames: { A1: '', A2: '', A3: '', A4: '', A5: '', B: '', C: '', D: '', E: '' },
    flags: flagArray,
  };
}

describe('PassabilityGrid (synthetic maps)', () => {
  it('allows movement everywhere on a fully open floor', () => {
    const layer0 = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const map = buildMap(3, 3, { 0: layer0 });
    const tileset = buildTileset({ 1: 0 });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(1, 1, 'up')).toBe(true);
    expect(grid.canMove(1, 1, 'down')).toBe(true);
    expect(grid.canMove(1, 1, 'left')).toBe(true);
    expect(grid.canMove(1, 1, 'right')).toBe(true);
  });

  it('blocks out-of-bounds movement regardless of flags', () => {
    const layer0 = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const map = buildMap(3, 3, { 0: layer0 });
    const tileset = buildTileset({ 1: 0 });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'left')).toBe(false);
    expect(grid.canMove(0, 0, 'up')).toBe(false);
    expect(grid.canMove(2, 2, 'right')).toBe(false);
    expect(grid.canMove(2, 2, 'down')).toBe(false);
  });

  it('blocks leaving a tile in the direction its own directional bit forbids', () => {
    // 3x1 row: tile (0,0) has its right side sealed.
    const layer0 = [2, 1, 1];
    const map = buildMap(3, 1, { 0: layer0 });
    const tileset = buildTileset({ 1: 0, 2: IMPASSABLE_RIGHT });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'right')).toBe(false);
  });

  it('blocks entering a tile from the side its own directional bit forbids, even if the source tile allows leaving', () => {
    // 4x1 row: tile (2,0) cannot be entered from the left (moving right into it).
    const layer0 = [1, 1, 5, 1];
    const map = buildMap(4, 1, { 0: layer0 });
    const tileset = buildTileset({ 1: 0, 5: IMPASSABLE_LEFT });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(1, 0, 'right')).toBe(false);
    // Leaving (2,0) rightward is unaffected by its impassableLeft bit.
    expect(grid.canMove(2, 0, 'right')).toBe(true);
  });

  it('ignores the star (upper-layer) bit and keeps looking at layers below it', () => {
    // Layer 3 (top) at (0,0) is star-flagged and would otherwise block
    // right movement, but must be skipped; layer 0 below is open.
    const layer0 = [1, 1, 1, 1];
    const layer3 = [6, 0, 0, 0];
    const map = buildMap(2, 2, { 0: layer0, 3: layer3 });
    const tileset = buildTileset({ 1: 0, 6: STAR_UPPER_LAYER | IMPASSABLE_RIGHT });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'right')).toBe(true);
  });

  it('blocks every direction for an all-direction-impassable tile', () => {
    const layer0 = [1, 1, 1, 7, 1, 1, 1, 1, 1];
    const map = buildMap(3, 3, { 0: layer0 });
    const tileset = buildTileset({
      1: 0,
      7: IMPASSABLE_DOWN | IMPASSABLE_LEFT | IMPASSABLE_RIGHT | IMPASSABLE_UP,
    });
    const grid = new PassabilityGrid(map, tileset);

    // Tile 7 sits at index 3 -> (x=0, y=1) in a 3-wide grid.
    expect(grid.canMove(0, 1, 'up')).toBe(false);
    expect(grid.canMove(0, 1, 'down')).toBe(false);
    expect(grid.canMove(0, 1, 'right')).toBe(false);
    // Neighbor (1,1) moving into the blocked tile is also refused.
    expect(grid.canMove(1, 1, 'left')).toBe(false);
  });

  it('treats a tile with no tile on any layer as open', () => {
    // All layers default to zero (empty) for this map -- no overrides.
    const map = buildMap(2, 2);
    const tileset = buildTileset({});
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'right')).toBe(true);
    expect(grid.canMove(0, 0, 'down')).toBe(true);
  });

  it('isStandable is false only when a tile is blocked from every direction at once', () => {
    const layer0 = [1, 2, 7];
    const map = buildMap(3, 1, { 0: layer0 });
    const tileset = buildTileset({
      1: 0,
      2: IMPASSABLE_RIGHT,
      7: IMPASSABLE_DOWN | IMPASSABLE_LEFT | IMPASSABLE_RIGHT | IMPASSABLE_UP,
    });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.isStandable(0, 0)).toBe(true); // fully open
    expect(grid.isStandable(1, 0)).toBe(true); // partially blocked, still standable
    expect(grid.isStandable(2, 0)).toBe(false); // fully sealed
    expect(grid.isStandable(-1, 0)).toBe(false); // out of bounds
  });
});
