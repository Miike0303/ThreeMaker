import { GAME_SAVE_MAGIC } from './constants.js';
import type { GameSaveDocument } from './document.js';
import type { GameSaveSnapshot, SaveWorldValue } from './types.js';

function copyWorld(
  world: Readonly<Record<string, SaveWorldValue>>,
): Record<string, SaveWorldValue> {
  return { ...world };
}

/**
 * Pure: runtime progress → on-disk document (current schema version).
 * Copies world so later host mutations cannot corrupt the document.
 */
export function gameSaveDocumentFromSnapshot(snapshot: GameSaveSnapshot): GameSaveDocument {
  return {
    magic: GAME_SAVE_MAGIC,
    version: 1,
    player: {
      mapFile: snapshot.mapFile,
      x: snapshot.x,
      y: snapshot.y,
      floor: snapshot.floor,
      facing: snapshot.facing,
    },
    world: copyWorld(snapshot.world),
  };
}

/**
 * Pure: validated document → runtime progress the host can apply
 * (teleport player, hop map, rehydrate WorldState keys).
 */
export function snapshotFromGameSaveDocument(document: GameSaveDocument): GameSaveSnapshot {
  return {
    mapFile: document.player.mapFile,
    x: document.player.x,
    y: document.player.y,
    floor: document.player.floor,
    facing: document.player.facing,
    world: copyWorld(document.world),
  };
}
