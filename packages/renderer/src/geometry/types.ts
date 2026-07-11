import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { CliffEdgeData } from './elevation.js';

/** RPG Maker MV/MZ standard tile edge length in source-image pixels. */
export const TILE_SIZE_PX = 48;

/** Default chunk edge length in tiles; chunks bound geometry rebuild cost on large maps. */
export const DEFAULT_CHUNK_SIZE = 16;

/** Whether a tile sits on the flat ground plane or is extruded as a standing wall-like quad. */
export type ElevationClass = 'ground' | 'upper';

/** A normalized (0-1) UV rectangle, already flipped to three.js' V-up texture space. */
export interface UvRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** Pixel dimensions of a loaded tileset sheet image, needed to convert a tile id into a UV rect. */
export interface SheetPixelSize {
  readonly width: number;
  readonly height: number;
}

/** Pixel size per sheet, for only the sheets actually available/loaded. */
export type SheetPixelSizes = Partial<Record<TileSheetId, SheetPixelSize>>;

/** One tile ready to be turned into a quad by the scene layer. */
export interface TileBuildData {
  /** Tile column within the full map (not the chunk). */
  readonly tileX: number;
  /** Tile row within the full map (not the chunk). */
  readonly tileY: number;
  /** Which of the map's 4 editable tile layers this tile came from (0 = bottom). */
  readonly layerIndex: 0 | 1 | 2 | 3;
  readonly sheet: TileSheetId;
  /**
   * 1 entry for a plain tile (covers the whole tile), or 4 for an autotile
   * (one per quarter, in destination order [top-left, top-right,
   * bottom-left, bottom-right] -- see `computeAutotileQuads` in `tile-uv.ts`).
   */
  readonly quads: readonly UvRect[];
  readonly elevation: ElevationClass;
  /**
   * Region-derived floor elevation (MV3D convention: region 1-7 = that many
   * tile-heights up), in tile-height units. Optional/defaults to 0 so
   * existing literal `TileBuildData` fixtures (tests, callers built before
   * this field existed) keep compiling unchanged.
   */
  readonly height?: number;
  /**
   * Cliff side faces this tile's own elevated ground needs, one per edge
   * whose neighbor sits lower. Only ever populated for the tile that "owns"
   * a map cell's floor (the layer-0 ground tile there) -- see
   * `chunk-geometry.ts` -- so a cell's cliff faces aren't duplicated across
   * whatever else got painted on higher editable layers at the same spot.
   */
  readonly cliffEdges?: readonly CliffEdgeData[];
}

/**
 * One tile's shadow-pencil mark (map data layer 4). RPG Maker renders each
 * set bit as a black, half-opacity quarter of the tile; bit order matches
 * corescript's `Tilemap._addShadow`: bit 0 = upper-left, bit 1 = upper-right,
 * bit 2 = lower-left, bit 3 = lower-right.
 */
export interface ShadowBuildData {
  /** Tile column within the full map (not the chunk). */
  readonly tileX: number;
  /** Tile row within the full map (not the chunk). */
  readonly tileY: number;
  /** Quarter bitmask, 1-15 (0 marks are not emitted). */
  readonly mask: number;
  /** Region-derived floor elevation at this tile, in tile-height units. Optional/defaults to 0, see `TileBuildData.height`. */
  readonly height?: number;
}

/** All tiles belonging to one chunkSize x chunkSize region of the map. */
export interface ChunkBuildData {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly tiles: readonly TileBuildData[];
  /** Shadow-pencil marks inside this chunk; omitted/empty when the region has none. */
  readonly shadows?: readonly ShadowBuildData[];
}
