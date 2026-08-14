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
export type {
  CameraFollowTarget,
  CameraMode,
  CameraPose,
  CameraRigParams,
  Vec3Like,
} from './runtime/camera-rig.js';
export {
  clampTiltDeg,
  computeCameraPose,
  cycleCameraMode,
  FIRST_PERSON_HEAD_HEIGHT_TILES,
  MAX_TILT_DEG,
  MIN_TILT_DEG,
  TOP_DOWN_TILT_DEG,
} from './runtime/camera-rig.js';
export { clampRange } from './runtime/clamp.js';
export type { FloorElevationSource } from './runtime/floor-elevation-source.js';
export { groundYAt } from './runtime/ground-y.js';
export type { Hd2dKnobs, Hd2dKnobsOverride } from './runtime/hd2d-knobs.js';
export { clampFocusDistance, DEFAULT_HD2D_KNOBS, resolveKnobs } from './runtime/hd2d-knobs.js';
export type { FogUniforms, Hd2dPipeline } from './runtime/hd2d-pipeline.js';
export {
  applyFogUniforms,
  createFogUniforms,
  createHd2dPipeline,
} from './runtime/hd2d-pipeline.js';
export type { LightBudget } from './runtime/light-budget.js';
export { LIGHT_BUDGET } from './runtime/light-budget.js';
export type { MapLightsBundle, MapLightsBundleDeps, NpcLightAnchor } from './runtime/map-lights.js';
export { ATTACH_HEIGHT_FACTOR, assertLightBudget, buildMapLights } from './runtime/map-lights.js';
export type {
  MapPropsBundle,
  MapPropsBundleDeps,
  ParseGltf,
  ParseGltfResult,
} from './runtime/map-props.js';
export { buildMapProps, parseGltfBytes } from './runtime/map-props.js';
export type { SessionClockWorld } from './runtime/session-clock.js';
export {
  CLOCK_MINUTES_KEY,
  formatClockMinutes,
  isValidClockMinutes,
  resyncClockFromWorldValue,
  tickSessionClock,
} from './runtime/session-clock.js';
export type { WeatherMode } from './runtime/session-weather.js';
export {
  composeAmbientIntensity,
  parseWeatherMode,
  WEATHER_KEY,
  weatherDimFactor,
} from './runtime/session-weather.js';
export type { BaseSceneLightRgb, BaseSceneLightSetup } from './runtime/sheet-tile-lighting.js';
export {
  baseSceneLightSetup,
  buildSheetLightingOptions,
  dayNightAmbientFactor,
  mapHasAuthoredLights,
} from './runtime/sheet-tile-lighting.js';
export { tileCenterToWorld } from './runtime/tile-world.js';
export type { WeatherLayer, WeatherLayerDeps } from './runtime/weather-layer.js';
export { createWeatherLayer, WEATHER_LOOK_PRESETS } from './runtime/weather-layer.js';
export type { BuildChunkGroupOptions } from './scene/build-chunk-group.js';
export { buildChunkGroup } from './scene/build-chunk-group.js';
export type { PixelArtTextureOptions } from './scene/pixel-art-texture.js';
export { configurePixelArtTexture, loadSheetTexture } from './scene/pixel-art-texture.js';
export type { SheetLightingOptions } from './scene/sheet-materials.js';
export { createShadowMaterial, createSheetMaterials } from './scene/sheet-materials.js';
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
