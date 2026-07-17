import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { CliffEdgeData, RampData } from './elevation.js';

/** RPG Maker MV/MZ standard tile edge length in source-image pixels. */
export const TILE_SIZE_PX = 48;

/** Default chunk edge length in tiles; chunks bound geometry rebuild cost on large maps. */
export const DEFAULT_CHUNK_SIZE = 16;

/**
 * Whether a tile sits on the flat ground plane, is extruded as a standing
 * star-bit wall-like quad, or is an impassable non-A "object" tile
 * (furniture, signs, trees on the B/C/D/E sheets) rendered as its own
 * upright standing quad -- HD-2D bug fix: these previously fell through to
 * the flat "ground" branch and rendered squashed on the floor instead of
 * standing up like the billboarded player/NPC sprites they visually
 * represent. See `chunk-geometry.ts`'s classification and
 * `build-chunk-group.ts`'s `'object'` branch (reuses `buildWallQuad`, the
 * same upright-quad mechanism `'upper'` star tiles already use -- no second
 * billboard mechanism).
 */
export type ElevationClass = 'ground' | 'upper' | 'object';

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
  /**
   * Only present for the layer-0 ground tile of a map cell classified
   * `'ramp'` (same cell-ownership rule as `cliffEdges` -- see
   * `chunk-geometry.ts`): the slope's downhill direction and the two
   * heights its edges span. Drives `build-chunk-group.ts`'s inclined quad +
   * skirt faces, and suppresses the `cliffEdges` entry on the ramp's own
   * downhill edge (the slope already meets the lower neighbor's floor
   * exactly, so no separate vertical face is needed there).
   */
  readonly ramp?: RampData;
  /**
   * Only present for `elevation === 'upper'` (star-bit) tiles: where and how
   * high this tile's standing quad should actually be anchored, per MV3D's
   * documented "tileoffset" convention (its star tiles default to
   * `tileOffset(y:1)` -- a one-cell southward shift; see
   * https://cutievirus.itch.io/mv3d/devlog/467498). RPG Maker map authors
   * draw a tall object's overhanging top portion as a star tile one cell
   * NORTH of its ground/base tile, because the 2D renderer's row-major
   * draw order then makes that overhang read as sitting on top of the tile
   * below. Rendering the star tile as a standing quad at its OWN cell (the
   * pre-fix behavior) instead leaves it floating one tile north of where it
   * visually belongs -- see `computeStarStack` in `chunk-geometry.ts`.
   */
  readonly starStack?: StarStackData;
}

/**
 * Where a star-bit tile's standing quad anchors, computed by
 * `computeStarStack` in `chunk-geometry.ts`.
 */
export interface StarStackData {
  /**
   * Map row (tileY) of the base tile this star tile's quad stands on --
   * always `> ` the star tile's own `tileY` (south of it). May equal
   * `map.height` when the star tile sits on the southern map edge with no
   * tile below it; the map edge is then treated as ground level 0, matching
   * `computeCliffEdges`'s off-map convention.
   */
  readonly baseTileY: number;
  /**
   * How many other star tiles sit between this one and the base (0 = this
   * tile is the bottommost of the stack, standing directly on the base).
   * The quad spans `[level, level + 1] * wallHeight` above the base's own
   * top.
   */
  readonly level: number;
  /** Region-derived floor elevation of the base tile (tile-height units), or 0 if the base is off-map. */
  readonly baseHeight: number;
  /** Whether the base tile's ground layer is an A3/A4 wall-autotile prism -- the star quad then stacks on top of the prism, not the bare floor. */
  readonly baseIsWall: boolean;
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
