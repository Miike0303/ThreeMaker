import type { RampCellInput, RpgmMap, RpgmTileset } from '@threemaker/importer-rpgm';
import {
  computeRampGrid,
  decodeTileFlags,
  getTileSheet,
  heightForRegion,
} from '@threemaker/importer-rpgm';
import { computeCliffEdges, isObjectSheet, rampDataAt } from './elevation.js';
import { computeTileUv } from './tile-uv.js';
import type {
  ChunkBuildData,
  ShadowBuildData,
  SheetPixelSizes,
  StarStackData,
  TileBuildData,
} from './types.js';
import { DEFAULT_CHUNK_SIZE, TILE_SIZE_PX } from './types.js';

/**
 * Height / star-bit / wall-autotile lookup grids for `buildChunks`.
 * Allocates full-map typed arrays (so `y * width + x` indexing stays
 * unchanged) but only *fills* `region` -- a scoped rebuild leaves cells
 * outside that window at 0, which is correct because those cells are
 * never read (tile scan is also scoped) except along the halo/south
 * columns the region is required to include.
 */
function fillLookupGrids(
  map: RpgmMap,
  tileset: RpgmTileset,
  region: TileRegion,
): { heightGrid: Uint8Array; upperGrid: Uint8Array; wallGrid: Uint8Array } {
  const { width } = map;
  const size = width * map.height;
  const heightGrid = new Uint8Array(size);
  const upperGrid = new Uint8Array(size);
  const wallGrid = new Uint8Array(size);
  const regions = map.layers.regions;

  for (let y = region.yStart; y < region.yEnd; y++) {
    const row = y * width;
    for (let x = region.xStart; x < region.xEnd; x++) {
      heightGrid[row + x] = heightForRegion(regions[row + x] ?? 0);
    }
  }

  // One pass sets both marker grids (they used to be two independent
  // W×H×4 walks). Skip the tile-id read once both bits at a cell are set.
  for (const layer of map.layers.tileLayers) {
    for (let y = region.yStart; y < region.yEnd; y++) {
      const row = y * width;
      for (let x = region.xStart; x < region.xEnd; x++) {
        const i = row + x;
        if (upperGrid[i] && wallGrid[i]) continue;
        const tileId = layer[i] ?? 0;
        if (tileId === 0) continue;
        if (!upperGrid[i] && decodeTileFlags(tileset.flags[tileId] ?? 0).isUpperLayer) {
          upperGrid[i] = 1;
        }
        if (!wallGrid[i]) {
          const sheet = getTileSheet(tileId);
          if (sheet === 'A3' || sheet === 'A4') wallGrid[i] = 1;
        }
      }
    }
  }

  return { heightGrid, upperGrid, wallGrid };
}

/**
 * Where a star-bit tile at `(x, y)` should actually stand, per MV3D's
 * "tileoffset" convention (see `StarStackData`'s doc comment): scans south
 * past any other star tiles stacked below this one until it finds the first
 * non-star row (or the map's southern edge) -- that row is the base. `level`
 * counts how many star rows were skipped, so the topmost tile of a tall
 * stack renders above the ones below it instead of all piling into the same
 * spot.
 */
function computeStarStack(
  x: number,
  y: number,
  map: RpgmMap,
  upperGrid: Uint8Array,
  heightGrid: Uint8Array,
  wallGrid: Uint8Array,
): StarStackData {
  let level = 0;
  let scanY = y + 1;
  while (scanY < map.height && upperGrid[scanY * map.width + x]) {
    level++;
    scanY++;
  }
  const inBounds = scanY < map.height;
  return {
    baseTileY: scanY,
    level,
    baseHeight: inBounds ? (heightGrid[scanY * map.width + x] ?? 0) : 0,
    baseIsWall: inBounds ? wallGrid[scanY * map.width + x] !== 0 : false,
  };
}

/** A rectangular tile-space region, `[xStart, xEnd)` x `[yStart, yEnd)`. */
interface TileRegion {
  readonly xStart: number;
  readonly yStart: number;
  readonly xEnd: number;
  readonly yEnd: number;
}

/** Parses a `"chunkX,chunkY"` key (see `chunkKey` in `streaming/chunk-streamer.ts`) back into numbers. */
function parseChunkKey(key: string): { readonly chunkX: number; readonly chunkY: number } {
  const [xPart, yPart] = key.split(',');
  return { chunkX: Number(xPart), chunkY: Number(yPart) };
}

/** The tile-space rectangle one chunk covers, clipped to the map's actual bounds (edge chunks are often partial). */
function chunkTileRegion(
  chunkX: number,
  chunkY: number,
  chunkSize: number,
  mapWidth: number,
  mapHeight: number,
): TileRegion {
  const xStart = chunkX * chunkSize;
  const yStart = chunkY * chunkSize;
  return {
    xStart,
    yStart,
    xEnd: Math.min(xStart + chunkSize, mapWidth),
    yEnd: Math.min(yStart + chunkSize, mapHeight),
  };
}

/**
 * Cells the lookup grids must fill so a scoped rebuild stays byte-identical
 * to a full build filtered to those chunks: the scan rectangles, plus a
 * 1-tile halo (cliff / ramp neighbors) and every row south of the union
 * (`computeStarStack` walks `y+1` until a non-star cell). Stale/empty
 * rectangles contribute nothing; if none remain, the caller returns `[]`
 * without allocating grids.
 */
function lookupGridFillRegion(
  mapWidth: number,
  mapHeight: number,
  scanRegions: readonly TileRegion[],
): TileRegion | undefined {
  let xStart = Number.POSITIVE_INFINITY;
  let yStart = Number.POSITIVE_INFINITY;
  let xEnd = Number.NEGATIVE_INFINITY;
  for (const region of scanRegions) {
    if (region.xStart >= region.xEnd || region.yStart >= region.yEnd) continue;
    xStart = Math.min(xStart, region.xStart);
    yStart = Math.min(yStart, region.yStart);
    xEnd = Math.max(xEnd, region.xEnd);
  }
  if (xStart === Number.POSITIVE_INFINITY) return undefined;
  return {
    xStart: Math.max(0, xStart - 1),
    yStart: Math.max(0, yStart - 1),
    xEnd: Math.min(mapWidth, xEnd + 1),
    yEnd: mapHeight,
  };
}

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
 *
 * `onlyChunks`, when given, scopes the tile/shadow scan to ONLY the
 * tile-space rectangles those chunk keys cover -- the output is exactly
 * equivalent to a full build filtered down to those keys (see
 * `chunk-geometry.test.ts`'s "onlyChunks" property test), but at a fraction
 * of the cost on a large map, since cells outside the requested chunks are
 * never even visited. Lookup grids (`heightGrid`/`upperGrid`/`wallGrid`)
 * fill the same window plus a 1-tile halo and the columns south of it
 * (`computeStarStack` walks toward the map's southern edge; cliffs read
 * one neighbor in each cardinal direction). `rampGrid` is already O(ramp
 * cells), not O(map area).
 *
 * `rampCells`, when given, is the resolved list of map cells classified
 * `'ramp'` by tileset semantics (see importer-rpgm's `computeRampGrid`,
 * which this function calls directly -- callers resolve `SemanticOverrides`
 * lookups into this list; `buildChunks` never re-derives ramp semantics
 * itself, matching the one-directional layering importer-rpgm's own
 * `RampCellInput` doc describes). Omitted/empty degenerates every ramp
 * lookup to "no ramp" (an all-zero `rampGrid`), so a map with no ramp-tagged
 * cells renders byte-identical to before this feature existed.
 */
export function buildChunks(
  map: RpgmMap,
  tileset: RpgmTileset,
  sheetPixelSizes: SheetPixelSizes,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  onlyChunks?: ReadonlySet<string>,
  rampCells?: readonly RampCellInput[],
  tilePixelSize: number = TILE_SIZE_PX,
): ChunkBuildData[] {
  if (chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive number, got ${chunkSize}.`);
  }

  // Scan regions: the whole map (full rebuild), or just the tile-space
  // rectangles the requested chunk keys cover (scoped rebuild). Chunk keys
  // outside the map's actual chunk grid clip to an empty (zero-area)
  // region rather than throwing -- callers requesting a stale/out-of-range
  // key just get nothing back for it, matching "ignores chunk keys the map
  // has no data for" elsewhere in this pipeline.
  const regions: readonly TileRegion[] = onlyChunks
    ? [...onlyChunks].map((key) => {
        const { chunkX, chunkY } = parseChunkKey(key);
        return chunkTileRegion(chunkX, chunkY, chunkSize, map.width, map.height);
      })
    : [{ xStart: 0, yStart: 0, xEnd: map.width, yEnd: map.height }];

  const fillRegion = lookupGridFillRegion(map.width, map.height, regions);
  if (!fillRegion) return [];

  const { heightGrid, upperGrid, wallGrid } = fillLookupGrids(map, tileset, fillRegion);
  const rampGrid = computeRampGrid(
    { heightGrid, mapWidth: map.width, mapHeight: map.height },
    rampCells ?? [],
  );

  const chunkTiles = new Map<string, TileBuildData[]>();

  const layers = map.layers.tileLayers;
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex];
    if (!layer) continue;

    for (const region of regions) {
      for (let y = region.yStart; y < region.yEnd; y++) {
        for (let x = region.xStart; x < region.xEnd; x++) {
          const tileId = layer[y * map.width + x] ?? 0;
          if (tileId === 0) continue;

          const tileUv = computeTileUv(tileId, sheetPixelSizes, tilePixelSize);
          if (!tileUv) continue;

          const flags = decodeTileFlags(tileset.flags[tileId] ?? 0);
          // HD-2D upright-object bug fix: an impassable (any of the 4
          // directional bits) tile on a non-autotile "object" sheet
          // (B/C/D/E -- furniture, signs, trees, statues) renders as a
          // standing quad, same mechanism as an 'upper' star tile, instead
          // of falling through to the flat 'ground' branch and rendering
          // squashed on the floor. A1/A2/A5 floor autotiles are excluded
          // even when impassable (e.g. water/chasm) -- see
          // `isObjectSheet`'s own doc comment.
          const isImpassable =
            flags.impassableDown ||
            flags.impassableLeft ||
            flags.impassableRight ||
            flags.impassableUp;
          const elevation = flags.isUpperLayer
            ? 'upper'
            : isObjectSheet(tileUv.sheet) && isImpassable
              ? 'object'
              : 'ground';
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

          // Same layer-0/ground ownership rule as cliffEdges above: a ramp's
          // slope descriptor belongs to the cell's own floor tile only, so
          // it isn't duplicated across whatever else got painted on higher
          // editable layers at the same spot.
          const ramp =
            layerIndex === 0 && elevation === 'ground'
              ? rampDataAt(rampGrid[y * map.width + x] ?? 0, height)
              : undefined;

          // ponytail: chunk assignment below still keys off this tile's own
          // (x, y), not its shifted `starStack.baseTileY` -- a star tile right
          // at a chunk's southern edge can therefore land in the chunk one row
          // north of where it visually renders. Harmless in practice (the
          // shift is at most a few tiles, bounded by object height) and not
          // worth the extra bookkeeping this slice.
          const starStack =
            elevation === 'upper'
              ? computeStarStack(x, y, map, upperGrid, heightGrid, wallGrid)
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
            ...(ramp ? { ramp } : {}),
            ...(starStack ? { starStack } : {}),
          });
        }
      }
    }
  }

  const chunkShadows = new Map<string, ShadowBuildData[]>();
  for (const region of regions) {
    for (let y = region.yStart; y < region.yEnd; y++) {
      for (let x = region.xStart; x < region.xEnd; x++) {
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
