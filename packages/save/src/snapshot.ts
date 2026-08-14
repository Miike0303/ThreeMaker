import { CURRENT_GAME_SAVE_VERSION, GAME_SAVE_MAGIC } from './constants.js';
import type { GameSaveDocument } from './document.js';
import type { GameSaveSnapshot, SaveWorldValue } from './types.js';

function copyRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return { ...record };
}

/**
 * Pure: runtime progress → on-disk document (current schema version).
 * Copies nested records so later host mutations cannot corrupt the document.
 */
export function gameSaveDocumentFromSnapshot(snapshot: GameSaveSnapshot): GameSaveDocument {
  return {
    magic: GAME_SAVE_MAGIC,
    version: CURRENT_GAME_SAVE_VERSION,
    player: {
      mapFile: snapshot.mapFile,
      x: snapshot.x,
      y: snapshot.y,
      floor: snapshot.floor,
      facing: snapshot.facing,
    },
    world: copyRecord(snapshot.world),
    inventory: copyRecord(snapshot.inventory),
    stats: copyRecord(snapshot.stats),
    stories: copyRecord(snapshot.stories),
  };
}

/**
 * Pure: validated document → runtime progress the host can apply
 * (teleport player, hop map, rehydrate WorldState / inventory / stats / stories).
 */
export function snapshotFromGameSaveDocument(document: GameSaveDocument): GameSaveSnapshot {
  return {
    mapFile: document.player.mapFile,
    x: document.player.x,
    y: document.player.y,
    floor: document.player.floor,
    facing: document.player.facing,
    world: copyRecord(document.world),
    inventory: copyRecord(document.inventory),
    stats: copyRecord(document.stats),
    stories: copyRecord(document.stories),
  };
}

// Keep SaveWorldValue visible to callers that re-export from snapshot path.
export type { SaveWorldValue };
