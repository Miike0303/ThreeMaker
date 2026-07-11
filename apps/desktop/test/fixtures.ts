import type { RpgmMap, RpgmMapLayers, TileLayer } from '@threemaker/importer-rpgm';

/**
 * Builds a minimal synthetic `RpgmMap`. `regions` defaults to all-zero
 * (ground level everywhere).
 *
 * Kept as a small local copy rather than importing
 * `packages/gameplay/test/fixtures.ts` directly: that file lives inside
 * another package's `test/` directory, not behind `@threemaker/gameplay`'s
 * public `src/index.ts` export, so reaching into it from here would couple
 * this app's tests to another package's internal test layout instead of its
 * published surface. `apps/desktop`'s tests only ever need the
 * simplified (no `layerOverrides`) form, so duplicating just that much is
 * cheaper than the cross-package coupling.
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
