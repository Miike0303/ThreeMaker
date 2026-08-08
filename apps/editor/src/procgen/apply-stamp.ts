/**
 * Apply a dungeon stamp onto floor 0 of a MapDocument (pure).
 */
import type { MapDocument } from '@threemaker/map-format';
import { pickMainRoomSpawn, type DungeonStampResult } from './dungeon-stamp.js';

export type ApplyDungeonStampOptions = {
  /**
   * When true, overwrite document spawn with the center of the largest
   * stamped room on floor 0 (so Generate is immediately playable).
   * Default false preserves existing spawn/events/npcs narrative data.
   */
  readonly placeSpawnInMainRoom?: boolean;
};

export function applyDungeonStampToMapDocument(
  doc: MapDocument,
  stamp: DungeonStampResult,
  options: ApplyDungeonStampOptions = {},
): MapDocument {
  const floor0 = doc.floors[0];
  if (!floor0) {
    throw new Error('map document has no floors to stamp');
  }
  const expected = doc.width * doc.height;
  for (const layer of stamp.layers) {
    if (layer.length !== expected) {
      throw new Error(
        `stamp layer length ${layer.length} does not match map size ${expected} (${doc.width}x${doc.height})`,
      );
    }
  }
  const [tiles0, tiles1, tiles2, tiles3] = stamp.layers;
  const nextFloor = {
    ...floor0,
    layers: {
      ...floor0.layers,
      tiles: [tiles0.slice(), tiles1.slice(), tiles2.slice(), tiles3.slice()] as [
        number[],
        number[],
        number[],
        number[],
      ],
    },
  };
  const next: MapDocument = {
    ...doc,
    floors: doc.floors.map((f, i) => (i === 0 ? nextFloor : f)),
  };
  if (!options.placeSpawnInMainRoom) {
    return next;
  }
  const pos = pickMainRoomSpawn(stamp.rooms, doc.width, doc.height);
  return {
    ...next,
    spawn: { x: pos.x, y: pos.y, floor: floor0.id },
  };
}
