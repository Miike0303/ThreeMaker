export type { MapMigration } from './migrate.js';
export { clearMigrations, migrateV1ToV2, parseMapDocument, registerMigration } from './migrate.js';
export type {
  FloorDocument,
  MapDocument,
  MapFormatErrorCode,
  MapLayers,
  MapTilesetDocument,
  RampDirection,
  SemanticClass,
  SemanticOverrides,
  SlotComposition,
  SlotSource,
  StairLinkDocument,
  StairLinkWaypoint,
  TileLayerData,
  TileSemanticEntry,
  TileSheetSlot,
} from './schema.js';
export {
  CURRENT_MAP_FORMAT_VERSION,
  DEFAULT_FLOOR_HEIGHT,
  MAP_FORMAT_MAGIC,
  MapFormatError,
  primaryFloorLayers,
  serializeMapDocument,
  TILE_SHEET_SLOTS,
  validateCurrentVersionShape,
  withPrimaryFloorLayers,
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
