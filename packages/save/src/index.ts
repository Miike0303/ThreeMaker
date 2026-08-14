export { CURRENT_GAME_SAVE_VERSION, GAME_SAVE_MAGIC } from './constants.js';
export type {
  GameSaveDocument,
  GameSaveDocumentV1,
  GameSaveDocumentV2,
  GameSaveDocumentV3,
  GameSaveParseFail,
  GameSaveParseOk,
  GameSaveParseResult,
  GameSavePlayerV1,
} from './document.js';
export {
  isGameSaveParseOk,
  parseGameSaveDocument,
  parseGameSaveJson,
  serializeGameSaveDocument,
} from './document.js';
export type { SaveMigration } from './migrate.js';
export {
  clearSaveMigrations,
  migrateSaveDocumentToCurrent,
  migrateTestFixtureV0ToV1,
  migrateV1ToV2,
  migrateV2ToV3,
  registerSaveMigration,
} from './migrate.js';
export { gameSaveDocumentFromSnapshot, snapshotFromGameSaveDocument } from './snapshot.js';
export type { GameSaveSnapshot, SaveFacing, SaveWorldValue } from './types.js';
