export type { SyntheticMapOptions } from './dev/synthetic-map.js';
export {
  generateSyntheticMap,
  ROSELIAM_DUNGEON_DECOR_TILE_ID,
  ROSELIAM_DUNGEON_GROUND_TILE_ID,
  ROSELIAM_DUNGEON_TILESET_ID,
  ROSELIAM_DUNGEON_WALL_TILE_ID,
} from './dev/synthetic-map.js';
export type { AutotileSheetId, QuarterOrigin, QuarterOrigins } from './geometry/autotile-tables.js';
export { computeAutotileQuarterOrigins } from './geometry/autotile-tables.js';
export { buildChunks } from './geometry/chunk-geometry.js';
export type { CliffEdgeData, EdgeDirection } from './geometry/elevation.js';
export {
  computeCliffEdges,
  computeHeightGrid,
  computeOpenEdges,
  computeWallTileKeys,
  heightForRegion,
  isWallSheet,
} from './geometry/elevation.js';
export type { TileUv } from './geometry/tile-uv.js';
export { computeTileUv } from './geometry/tile-uv.js';
export type {
  ChunkBuildData,
  ElevationClass,
  ShadowBuildData,
  SheetPixelSize,
  SheetPixelSizes,
  TileBuildData,
  UvRect,
} from './geometry/types.js';
export {
  DEFAULT_CHUNK_SIZE,
  TILE_SIZE_PX,
} from './geometry/types.js';
export type { BuildChunkGroupOptions } from './scene/build-chunk-group.js';
export { buildChunkGroup } from './scene/build-chunk-group.js';
export type { PixelArtTextureOptions } from './scene/pixel-art-texture.js';
export { configurePixelArtTexture, loadSheetTexture } from './scene/pixel-art-texture.js';
export type {
  ChunkSetDiff,
  StreamingTilemapSceneOptions,
} from './scene/streaming-tilemap-scene.js';
export { StreamingTilemapScene } from './scene/streaming-tilemap-scene.js';
export type { TilemapSceneOptions } from './scene/tilemap-scene.js';
export { TilemapScene } from './scene/tilemap-scene.js';
export type { ChunkStreamDiff, ChunkStreamerOptions } from './streaming/chunk-streamer.js';
export { ChunkStreamer, chunkKey, DEFAULT_BUILD_RADIUS } from './streaming/chunk-streamer.js';
export type { FloorVisibilityPolicy } from './streaming/floor-visibility.js';
export { OcclusionFloorPolicy, WindowedFloorPolicy } from './streaming/floor-visibility.js';
