import type { RpgmMap, RpgmMapLayers, RpgmTileset, TileLayer } from '@threemaker/importer-rpgm';

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

/**
 * Builds a minimal synthetic `RpgmTileset` with no directional-passage
 * flags set (every tile decisively open) -- see
 * `packages/gameplay/test/fixtures.ts`'s `buildTileset` for the fuller
 * flag-bearing version; this app's tests only ever need the empty-flags
 * form (floor-container tests block movement via elevation/edge-profile,
 * not tileset flags), kept local for the same cross-package reason as
 * `buildMap` above.
 */
export function buildTileset(): RpgmTileset {
  return {
    id: 1,
    name: 'synthetic',
    sheetNames: { A1: '', A2: '', A3: '', A4: '', A5: '', B: '', C: '', D: '', E: '' },
    flags: [],
  };
}
