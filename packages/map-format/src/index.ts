export type { CreateBlankMapDocumentOptions } from './blank-document.js';
export { createBlankMapDocument } from './blank-document.js';
export {
  inkSidecarRelativePath,
  isSafeStoryId,
  MAP_DOCUMENT_FILE_SUFFIX,
  SAFE_STORY_ID_PATTERN,
} from './ink-sidecar-path.js';
export type { MapMigration } from './migrate.js';
export {
  clearMigrations,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  parseMapDocument,
  registerMigration,
} from './migrate.js';
export { computeRoomIdGrid } from './rooms.js';
export type { RampCellInput } from './runtime-bridge.js';
export { deriveRampCellAt, deriveRampCells, syncRampCells } from './runtime-bridge.js';
export type {
  FloorDocument,
  LightDocument,
  MapDocument,
  MapEventScripts,
  MapFormatErrorCode,
  MapLayers,
  MapSpawn,
  MapTilesetDocument,
  NpcDocument,
  NpcFacing,
  NpcRoutineStopDocument,
  NpcSpriteRef,
  PropDocument,
  RampDirection,
  RoomDocument,
  RoomRect,
  SemanticClass,
  SemanticOverrides,
  SlotComposition,
  SlotSource,
  StairLinkDocument,
  StairLinkWaypoint,
  TileLayerData,
  TileSemanticEntry,
  TileSheetSlot,
  TriggerDocument,
  WorldSeedValue,
} from './schema.js';
export {
  CURRENT_MAP_FORMAT_VERSION,
  DEFAULT_FLOOR_HEIGHT,
  MAP_FORMAT_MAGIC,
  MapFormatError,
  serializeMapDocument,
  TILE_SHEET_SLOTS,
  validateCurrentVersionShape,
} from './schema.js';
export type {
  CommandStackState,
  CommandStepResult,
  TileCellDiff,
  TileDiff,
  TileLayerSet,
} from './tile-diff.js';
export {
  applyInverseTileDiff,
  applyTileDiff,
  COMMAND_STACK_CAP,
  EMPTY_COMMAND_STACK,
  invertTileDiff,
  pushCommand,
  redoCommand,
  undoCommand,
} from './tile-diff.js';
