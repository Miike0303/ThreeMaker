import type { RpgmMap, RpgmMapLayers, RpgmTileset, TileLayer } from '@threemaker/importer-rpgm';

/**
 * Builds a minimal synthetic `RpgmMap`. `layerOverrides` maps a tile-layer
 * index (0-3) to a row-major `TileLayer` of length `width*height`; any
 * omitted layer defaults to all-zero (empty). `regions` defaults to
 * all-zero (ground level everywhere, per the MV3D region-N-is-height-N
 * convention).
 *
 * Shared across `packages/gameplay`'s test suite so every test constructs
 * synthetic maps the same way; `apps/desktop/test/fixtures.ts` keeps its
 * own copy of the simplified (no `layerOverrides`) form since it lives in a
 * different package and importing this file across the package boundary
 * would reach past `@threemaker/gameplay`'s public `src/index.ts` export.
 */
export function buildMap(
  width: number,
  height: number,
  layerOverrides: Partial<Record<0 | 1 | 2 | 3, TileLayer>> = {},
  regions?: TileLayer,
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
    layers: { tileLayers, shadows: zeros, regions: regions ?? zeros },
  };
}

/** Builds a minimal synthetic `RpgmTileset`. `flags` is a sparse map of tile id -> raw flag bits. */
export function buildTileset(flags: Record<number, number>): RpgmTileset {
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
