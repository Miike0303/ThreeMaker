import type { RpgmMap, RpgmTileset } from '@threemaker/importer-rpgm';
import { computeHeightGrid, decodeTileFlags } from '@threemaker/importer-rpgm';
import { computeCliffEdges } from './elevation.js';
import { computeTileUv } from './tile-uv.js';
import type { ChunkBuildData, ShadowBuildData, SheetPixelSizes, TileBuildData } from './types.js';
import { DEFAULT_CHUNK_SIZE } from './types.js';

/**
 * Splits a map's 4 tile layers into `chunkSize` x `chunkSize` chunks of
 * render-ready tile data: which sheet each tile belongs to, its UV rect, and
 * whether it sits on the ground plane or should be extruded as a standing
 * "upper layer" quad (per the tileset's star-bit passability flag).
 *
 * The shadow-pencil layer (data layer 4) is carried through as per-chunk
 * `ShadowBuildData` so the scene layer can render RPG Maker's half-opacity
 * black quarter overlays; the region layer stays ignored. Empty tiles
 * (id 0) and tiles whose sheet has no known pixel size (not loaded, or
 * genuinely unused by this tileset) are skipped rather than throwing, since
 * both are routine, expected conditions in real map data.
 */
export function buildChunks(
  map: RpgmMap,
  tileset: RpgmTileset,
  sheetPixelSizes: SheetPixelSizes,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): ChunkBuildData[] {
  if (chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive number, got ${chunkSize}.`);
  }

  // Region-derived elevation (MV3D convention), computed once for the whole
  // map so cliff-edge lookups can freely check neighbors across chunk
  // boundaries (unlike the wall-prism interior-face check in
  // build-chunk-group.ts, which only has chunk-local data to work with).
  const heightGrid = computeHeightGrid(map);

  const chunkTiles = new Map<string, TileBuildData[]>();

  const layers = map.layers.tileLayers;
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex];
    if (!layer) continue;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tileId = layer[y * map.width + x] ?? 0;
        if (tileId === 0) continue;

        const tileUv = computeTileUv(tileId, sheetPixelSizes);
        if (!tileUv) continue;

        const flags = decodeTileFlags(tileset.flags[tileId] ?? 0);
        const elevation = flags.isUpperLayer ? 'upper' : 'ground';
        const height = heightGrid[y * map.width + x] ?? 0;

        const chunkX = Math.floor(x / chunkSize);
        const chunkY = Math.floor(y / chunkSize);
        const key = `${chunkX},${chunkY}`;
        let tiles = chunkTiles.get(key);
        if (!tiles) {
          tiles = [];
          chunkTiles.set(key, tiles);
        }

        // Cliff faces are derived once per map cell, from that cell's
        // layer-0 ground tile only -- ponytail: a ground tile painted on a
        // higher editable layer over an empty layer-0 at the same spot
        // won't get cliff faces this slice (real maps always paint their
        // base floor on layer 0, so this doesn't bite the fixtures here).
        const cliffEdges =
          layerIndex === 0 && elevation === 'ground'
            ? computeCliffEdges(heightGrid, map.width, map.height, x, y)
            : undefined;

        tiles.push({
          tileX: x,
          tileY: y,
          layerIndex: layerIndex as 0 | 1 | 2 | 3,
          sheet: tileUv.sheet,
          quads: tileUv.quads,
          elevation,
          ...(height !== 0 ? { height } : {}),
          ...(cliffEdges && cliffEdges.length > 0 ? { cliffEdges } : {}),
        });
      }
    }
  }

  const chunkShadows = new Map<string, ShadowBuildData[]>();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      // Only bits 0-3 are defined (one per tile quarter); mask off anything
      // above them defensively -- real editors never write more, but the
      // renderer should not amplify corrupt data into surprise quads.
      const mask = (map.layers.shadows[y * map.width + x] ?? 0) & 0xf;
      if (mask === 0) continue;

      const key = `${Math.floor(x / chunkSize)},${Math.floor(y / chunkSize)}`;
      let shadows = chunkShadows.get(key);
      if (!shadows) {
        shadows = [];
        chunkShadows.set(key, shadows);
      }
      const shadowHeight = heightGrid[y * map.width + x] ?? 0;
      shadows.push({
        tileX: x,
        tileY: y,
        mask,
        ...(shadowHeight !== 0 ? { height: shadowHeight } : {}),
      });
    }
  }

  const keys = new Set([...chunkTiles.keys(), ...chunkShadows.keys()]);
  const chunks: ChunkBuildData[] = [];
  for (const key of keys) {
    const [chunkXPart, chunkYPart] = key.split(',');
    const shadows = chunkShadows.get(key);
    chunks.push({
      chunkX: Number(chunkXPart),
      chunkY: Number(chunkYPart),
      tiles: chunkTiles.get(key) ?? [],
      ...(shadows ? { shadows } : {}),
    });
  }

  // Deterministic order (row-major by chunk) keeps tests and draw-call
  // ordering stable regardless of Map iteration order.
  chunks.sort((a, b) => a.chunkY - b.chunkY || a.chunkX - b.chunkX);
  return chunks;
}
