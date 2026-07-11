import type { RampCellInput, RpgmMap, RpgmTileset } from '@threemaker/importer-rpgm';
import {
  computeHeightGrid,
  computeRampGrid,
  decodeTileFlags,
  getTileSheet,
} from '@threemaker/importer-rpgm';
import { computeCliffEdges, rampDataAt } from './elevation.js';
import { computeTileUv } from './tile-uv.js';
import type {
  ChunkBuildData,
  ShadowBuildData,
  SheetPixelSizes,
  StarStackData,
  TileBuildData,
} from './types.js';
import { DEFAULT_CHUNK_SIZE } from './types.js';

/**
 * Marks every map cell that carries a star-bit ("upper layer") tile on any
 * of the 4 editable layers -- the per-cell lookup `computeStarStack` needs
 * to walk south past consecutive star tiles to find a stack's base, which
 * requires random access across the whole map, not just the tile currently
 * being visited in `buildChunks`' main loop.
 */
function computeUpperGrid(map: RpgmMap, tileset: RpgmTileset): Uint8Array {
  const grid = new Uint8Array(map.width * map.height);
  for (const layer of map.layers.tileLayers) {
    for (let i = 0; i < layer.length; i++) {
      if (grid[i]) continue;
      const tileId = layer[i] ?? 0;
      if (tileId === 0) continue;
      if (decodeTileFlags(tileset.flags[tileId] ?? 0).isUpperLayer) grid[i] = 1;
    }
  }
  return grid;
}

/**
 * Marks every map cell where any of the 4 tile layers holds a
 * ground-elevation (non-star) A3/A4 wall-autotile -- needed so a star tile
 * stacking on a wall base stands on top of the wall prism's height, not the
 * bare floor (see `computeStarStack`).
 */
function computeWallGrid(map: RpgmMap): Uint8Array {
  const grid = new Uint8Array(map.width * map.height);
  for (const layer of map.layers.tileLayers) {
    for (let i = 0; i < layer.length; i++) {
      if (grid[i]) continue;
      const tileId = layer[i] ?? 0;
      if (tileId === 0) continue;
      const sheet = getTileSheet(tileId);
      if (sheet === 'A3' || sheet === 'A4') grid[i] = 1;
    }
  }
  return grid;
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
 * never even visited. The region-derived grids (`heightGrid`/`upperGrid`/
 * `wallGrid`/`rampGrid`) are still computed over the WHOLE map regardless --
 * they are cheap flat typed-array passes, and cliff/star-stack/ramp lookups
 * need whole-map neighbor data to stay correct at a scoped chunk's own edges
 * (benchmarked as a small fraction of full `buildChunks` cost; see the
 * decision-gate benchmark in `test/build-chunks-benchmark.test.ts`).
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
): ChunkBuildData[] {
  if (chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive number, got ${chunkSize}.`);
  }

  // Region-derived elevation (MV3D convention), computed once for the whole
  // map so cliff-edge lookups can freely check neighbors across chunk
  // boundaries (unlike the wall-prism interior-face check in
  // build-chunk-group.ts, which only has chunk-local data to work with).
  const heightGrid = computeHeightGrid(map);
  const upperGrid = computeUpperGrid(map, tileset);
  const wallGrid = computeWallGrid(map);
  const rampGrid = computeRampGrid(
    { heightGrid, mapWidth: map.width, mapHeight: map.height },
    rampCells ?? [],
  );

  const chunkTiles = new Map<string, TileBuildData[]>();

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

  const layers = map.layers.tileLayers;
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex];
    if (!layer) continue;

    for (const region of regions) {
      for (let y = region.yStart; y < region.yEnd; y++) {
        for (let x = region.xStart; x < region.xEnd; x++) {
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
