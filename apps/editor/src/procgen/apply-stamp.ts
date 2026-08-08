/**
 * Apply a dungeon stamp onto floor 0 of a MapDocument (pure).
 */
import type { MapDocument } from '@threemaker/map-format';
import type { DungeonStampResult } from './dungeon-stamp.js';

export function applyDungeonStampToMapDocument(
  doc: MapDocument,
  stamp: DungeonStampResult,
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
  return {
    ...doc,
    floors: doc.floors.map((f, i) => (i === 0 ? nextFloor : f)),
  };
}
