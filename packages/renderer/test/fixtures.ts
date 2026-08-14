import type { RpgmMap, RpgmMapLayers, TileLayer } from '@threemaker/importer-rpgm';

/**
 * Builds a minimal synthetic `RpgmMap`. `regions` defaults to all-zero
 * (ground level everywhere).
 *
 * Kept as a small local copy rather than importing another package's
 * `test/fixtures.ts` directly: that file lives inside another package's
 * `test/` directory, not behind a public `src/index.ts` export.
 */
export function buildMap(width: number, height: number, regions?: TileLayer): RpgmMap {
  const size = width * height;
  const zeros: TileLayer = new Array(size).fill(0);
  const tileLayers: RpgmMapLayers['tileLayers'] = [zeros, zeros, zeros, zeros];

  return {
    id: 1,
    displayName: 'synthetic',
    width,
    height,
    tilesetId: 1,
    scrollType: 0,
    layers: { tileLayers, shadows: zeros, regions: regions ?? zeros },
  };
}
