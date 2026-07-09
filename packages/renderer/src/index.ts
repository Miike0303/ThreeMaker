export { buildChunks } from './geometry/chunk-geometry.js';
export type { TileUv } from './geometry/tile-uv.js';
export { computeTileUv } from './geometry/tile-uv.js';
export type {
  ChunkBuildData,
  ElevationClass,
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
export { configurePixelArtTexture, loadSheetTexture } from './scene/pixel-art-texture.js';
export type { TilemapSceneOptions } from './scene/tilemap-scene.js';
export { TilemapScene } from './scene/tilemap-scene.js';
