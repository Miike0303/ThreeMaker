// Browser-safe entry: pure parsers only. The Node-only project loader
// (which reads from the filesystem) lives at the `./node` subpath export so
// importing this package never drags `node:fs` into a browser bundle.

export type { ConvertRpgmMapOptions, RpgmPlayerStart } from './convert-rpgm-map.js';
export { convertRpgmMap } from './convert-rpgm-map.js';
export type { DocumentFloorToRpgmResult } from './document-floor.js';
export { documentFloorToRpgm } from './document-floor.js';
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
export type { SheetIdRange, TileSheetId } from './tile-id.js';
export {
  getAutotileKind,
  getAutotileShape,
  getLocalTileIndex,
  getTileSheet,
  isAutotile,
  SHEET_BASE_ID,
  SHEET_END_ID,
  SHEET_ID_RANGES,
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
