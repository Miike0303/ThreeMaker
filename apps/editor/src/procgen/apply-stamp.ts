/**
 * Apply a dungeon stamp onto floor 0 of a MapDocument (pure).
 */
import type { MapDocument } from '@threemaker/map-format';
import { assignSemanticClass } from '../semantic-store.js';
import { pickMainRoomSpawn, type DungeonStampResult } from './dungeon-stamp.js';
import {
  lightsFromDungeonRooms,
  mergeStampRoomLights,
  type StampRoomLightOptions,
} from './lights-from-stamp.js';
import { roomsFromDungeonStamp } from './rooms-from-stamp.js';

export type ApplyDungeonStampOptions = {
  /**
   * When true, overwrite document spawn with the center of the largest
   * stamped room on floor 0 (so Generate is immediately playable).
   * Default false preserves existing spawn/events/npcs narrative data.
   */
  readonly placeSpawnInMainRoom?: boolean;
  /**
   * When true, replace all rooms on floor 0 with stamp rooms (keeps rooms on
   * other floors). Default false preserves authored rooms.
   */
  readonly replaceFloor0Rooms?: boolean;
  /**
   * When true, place a point light at each stamp room center on floor 0
   * (replaces prior floor-0 placed lights; keeps attached + other floors).
   * Default false preserves existing lights.
   */
  readonly placeRoomLights?: boolean;
  /** Mood overrides for room lights (preset color/intensity/range/height). */
  readonly roomLightOptions?: StampRoomLightOptions;
};

/** Collect distinct non-zero tile ids from a stamp layer. */
function uniqueNonZeroIds(layer: readonly number[]): Set<number> {
  const ids = new Set<number>();
  for (const id of layer) {
    if (id !== 0) ids.add(id);
  }
  return ids;
}

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
  // DESIGN: walls on layer 2 + semantic `wall`; mid doors + furniture.
  // Only stamp.doors positions are tagged `door`; other mid non-zero ids → `furniture`.
  const wallIds = uniqueNonZeroIds(tiles2);
  const doorIds = new Set<number>();
  const furnitureIds = new Set<number>();
  const width = doc.width;
  for (const d of stamp.doors) {
    const id = tiles1[d.y * width + d.x] ?? 0;
    if (id !== 0) doorIds.add(id);
  }
  for (let i = 0; i < tiles1.length; i++) {
    const id = tiles1[i] ?? 0;
    if (id === 0 || doorIds.has(id)) continue;
    furnitureIds.add(id);
  }
  let nextSemantics = assignSemanticClass(doc.tileset.semantics, wallIds, 'wall');
  nextSemantics = assignSemanticClass(nextSemantics, doorIds, 'door');
  nextSemantics = assignSemanticClass(nextSemantics, furnitureIds, 'furniture');
  let next: MapDocument = {
    ...doc,
    floors: doc.floors.map((f, i) => (i === 0 ? nextFloor : f)),
    tileset: { ...doc.tileset, semantics: nextSemantics },
  };
  if (options.replaceFloor0Rooms) {
    const stampedRooms = roomsFromDungeonStamp(stamp.rooms, floor0.id);
    const otherFloors = doc.rooms.filter((r) => r.floor !== floor0.id);
    next = {
      ...next,
      rooms: [...otherFloors, ...stampedRooms],
    };
  }
  if (options.placeSpawnInMainRoom) {
    const pos = pickMainRoomSpawn(stamp.rooms, doc.width, doc.height);
    next = {
      ...next,
      spawn: { x: pos.x, y: pos.y, floor: floor0.id },
    };
  }
  if (options.placeRoomLights) {
    const stampLights = lightsFromDungeonRooms(
      stamp.rooms,
      floor0.id,
      options.roomLightOptions ?? {},
    );
    next = {
      ...next,
      lights: mergeStampRoomLights(next.lights, floor0.id, stampLights),
    };
  }
  return next;
}
