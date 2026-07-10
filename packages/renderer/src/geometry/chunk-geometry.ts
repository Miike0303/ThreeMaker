import type { RpgmMap, RpgmTileset } from '@threemaker/importer-rpgm';
import { decodeTileFlags } from '@threemaker/importer-rpgm';
import { computeTileUv } from './tile-uv.js';
import type { ChunkBuildData, SheetPixelSizes, TileBuildData } from './types.js';
import { DEFAULT_CHUNK_SIZE } from './types.js';

/**
 * Splits a map's 4 tile layers into `chunkSize` x `chunkSize` chunks of
 * render-ready tile data: which sheet each tile belongs to, its UV rect, and
 * whether it sits on the ground plane or should be extruded as a standing
 * "upper layer" quad (per the tileset's star-bit passability flag).
 *
 * Shadow-pencil and region layers are ignored in this slice. Empty tiles
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

        const chunkX = Math.floor(x / chunkSize);
        const chunkY = Math.floor(y / chunkSize);
        const key = `${chunkX},${chunkY}`;
        let tiles = chunkTiles.get(key);
        if (!tiles) {
          tiles = [];
          chunkTiles.set(key, tiles);
        }

        tiles.push({
          tileX: x,
          tileY: y,
          layerIndex: layerIndex as 0 | 1 | 2 | 3,
          sheet: tileUv.sheet,
          quads: tileUv.quads,
          elevation: flags.isUpperLayer ? 'upper' : 'ground',
        });
      }
    }
  }

  const chunks: ChunkBuildData[] = [];
  for (const [key, tiles] of chunkTiles) {
    const [chunkXPart, chunkYPart] = key.split(',');
    chunks.push({ chunkX: Number(chunkXPart), chunkY: Number(chunkYPart), tiles });
  }

  // Deterministic order (row-major by chunk) keeps tests and draw-call
  // ordering stable regardless of Map iteration order.
  chunks.sort((a, b) => a.chunkY - b.chunkY || a.chunkX - b.chunkX);
  return chunks;
}
