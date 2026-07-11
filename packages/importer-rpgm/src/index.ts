// Browser-safe entry: pure parsers only. The Node-only project loader
// (which reads from the filesystem) lives at the `./node` subpath export so
// importing this package never drags `node:fs` into a browser bundle.
export type {
  EdgeDirection,
  EdgeProfile,
  GridContext,
  HeightGridContext,
  RampCellInput,
  RampDirection,
} from './elevation.js';
export {
  computeHeightGrid,
  computeRampGrid,
  edgeProfileAt,
  heightForRegion,
  MAX_REGION_HEIGHT,
  profilesEqual,
  RAMP_DIRECTION_BY_CODE,
  surfaceHeightAt,
} from './elevation.js';
export { parseMap } from './parse-map.js';
export { parseMapInfos } from './parse-map-infos.js';
export { parseTilesets } from './parse-tilesets.js';
export type { TileFlags } from './tile-flags.js';
export { decodeTileFlags } from './tile-flags.js';
export type { TileSheetId } from './tile-id.js';
export {
  getAutotileKind,
  getAutotileShape,
  getLocalTileIndex,
  getTileSheet,
  isAutotile,
} from './tile-id.js';
export type {
  RpgmMap,
  RpgmMapInfo,
  RpgmMapLayers,
  RpgmProject,
  RpgmTileset,
  TileLayer,
  TileSheetNames,
} from './types.js';
