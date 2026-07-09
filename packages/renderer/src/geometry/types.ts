import type { TileSheetId } from '@threemaker/importer-rpgm';

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
  readonly uv: UvRect;
  readonly elevation: ElevationClass;
}

/** All tiles belonging to one chunkSize x chunkSize region of the map. */
export interface ChunkBuildData {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly tiles: readonly TileBuildData[];
}
