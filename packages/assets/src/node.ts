// Node-only entry: filesystem-walking code that must never end up in a
// browser bundle. Same convention as `@threemaker/importer-rpgm`'s `./node`
// subpath export.

export type {
  AssetFilter,
  AssetRow,
  DedupeStats,
  GameRow,
  IngestGameOptions,
  IngestGameResult,
  ScanErrorFilter,
  ScanErrorRow,
  TilesetRow,
  TilesetSheetRow,
  TilesetSlot,
  TilesetSummaryRow,
  UpsertTilesetInput,
  UpsertTilesetSheetInput,
} from './catalog.js';
export { Catalog, ingestGame, openCatalog } from './catalog.js';
export type { StoreObjectResult } from './object-store.js';
export { hashBytes, objectPath, storeObject } from './object-store.js';
export type {
  GameRecord,
  ScanError,
  ScanErrorCode,
  ScanOptions,
  ScanResult,
} from './scanner.js';
export { scanGames } from './scanner.js';
export type { TilesetIngestResult } from './tileset-ingest.js';
export { ingestTilesetsForGame } from './tileset-ingest.js';
