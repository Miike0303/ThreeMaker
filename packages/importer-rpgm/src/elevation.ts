import type { RpgmMap } from './types.js';

/**
 * MV3D community convention: a tile's region id (1-7) sets its floor
 * elevation, in tile-height units -- region N means "this tile's floor sits
 * N tile-heights above the default y=0 plane". Region 0 (unpainted) and any
 * id outside 1-7 (regions 8-255 are free-form, used by other plugins/events
 * for unrelated purposes such as encounter zones) are ground level.
 */
export const MAX_REGION_HEIGHT = 7;

/** Elevation (in tile-height units) a region id encodes, per the MV3D convention. */
export function heightForRegion(region: number): number {
  return region >= 1 && region <= MAX_REGION_HEIGHT ? region : 0;
}

/**
 * Per-tile elevation grid for a whole map, in tile-height units, row-major
 * (`width * height` entries, same indexing as `RpgmMapLayers`'s layers).
 * Pure function of the map's region layer -- cheap enough to recompute
 * whenever a map loads, no caching needed.
 */
export function computeHeightGrid(map: RpgmMap): Uint8Array {
  const size = map.width * map.height;
  const grid = new Uint8Array(size);
  const regions = map.layers.regions;
  for (let i = 0; i < size; i++) {
    grid[i] = heightForRegion(regions[i] ?? 0);
  }
  return grid;
}
