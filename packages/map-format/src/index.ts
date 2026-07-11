export type { MapMigration } from './migrate.js';
export { clearMigrations, parseMapDocument, registerMigration } from './migrate.js';
export type {
  MapDocument,
  MapFormatErrorCode,
  MapLayers,
  MapTilesetDocument,
  SemanticClass,
  SemanticOverrides,
  SlotComposition,
  SlotSource,
  TileLayerData,
  TileSemanticEntry,
  TileSheetSlot,
} from './schema.js';
export {
  CURRENT_MAP_FORMAT_VERSION,
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
