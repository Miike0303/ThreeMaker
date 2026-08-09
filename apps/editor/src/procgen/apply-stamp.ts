/**
 * Apply a dungeon stamp onto a target floor of a MapDocument (pure).
 * Default target is floor index 0 (ground); multi-floor maps pass active index.
 */
import type { MapDocument } from '@threemaker/map-format';
import { assignSemanticClass } from '../semantic-store.js';
import { pickMainRoomSpawn, type DungeonStampResult } from './dungeon-stamp.js';
import {
  ensurePlayerTorch,
  lightsFromDungeonRooms,
  mergeStampRoomLights,
  type PlayerTorchOptions,
  type StampRoomLightOptions,
} from './lights-from-stamp.js';
import { roomsFromDungeonStamp } from './rooms-from-stamp.js';
import {
  mergeStampStairLinks,
  pickAdjacentFloorIndex,
  roomLandingTile,
  stampStairLinkBetween,
} from './stairs-from-stamp.js';

export type ApplyDungeonStampOptions = {
  /**
   * Floor stack index to overwrite with stamp layers (default 0 = ground).
   * Out-of-range throws. Rooms/spawn/lights use that floor's id.
   */
  readonly targetFloorIndex?: number;
  /**
   * When true, overwrite document spawn with the center of the largest
   * stamped room on the target floor (so Generate is immediately playable).
   * Default false preserves existing spawn/events/npcs narrative data.
   */
  readonly placeSpawnInMainRoom?: boolean;
  /**
   * When true, replace all rooms on the target floor with stamp rooms
   * (keeps rooms on other floors). Name is historical (floor-0 default).
   * Default false preserves authored rooms.
   */
  readonly replaceFloor0Rooms?: boolean;
  /**
   * When true, place a point light at each stamp room center on the target
   * floor (replaces prior placed lights on that floor; keeps attached +
   * other floors). Default false preserves existing lights.
   */
  readonly placeRoomLights?: boolean;
  /** Mood overrides for room lights (preset color/intensity/range/height). */
  readonly roomLightOptions?: StampRoomLightOptions;
  /**
   * When true, ensure a single `attach: player` torch light exists
   * (re-Generate replaces prior player attaches). Default false.
   */
  readonly placePlayerTorch?: boolean;
  /** Overrides for the player torch (color/intensity/range/id). */
  readonly playerTorchOptions?: PlayerTorchOptions;
  /**
   * When true and the map has 2+ floors, place a bidirectional stair between
   * the stamped main room and the adjacent floor's main room (prefer floor
   * below; ground links up). Replaces prior links for that floor pair only.
   * No-op on single-floor maps. Default false preserves stairLinks.
   */
  readonly placeStairToAdjacentFloor?: boolean;
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
  const targetFloorIndex = options.targetFloorIndex ?? 0;
  if (
    !Number.isInteger(targetFloorIndex) ||
    targetFloorIndex < 0 ||
    targetFloorIndex >= doc.floors.length
  ) {
    throw new Error(
      `target floor index ${targetFloorIndex} is out of range (floors=${doc.floors.length})`,
    );
  }
  const targetFloor = doc.floors[targetFloorIndex];
  if (!targetFloor) {
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
    ...targetFloor,
    layers: {
      ...targetFloor.layers,
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
    floors: doc.floors.map((f, i) => (i === targetFloorIndex ? nextFloor : f)),
    tileset: { ...doc.tileset, semantics: nextSemantics },
  };
  if (options.replaceFloor0Rooms) {
    const stampedRooms = roomsFromDungeonStamp(stamp.rooms, targetFloor.id);
    const otherFloors = doc.rooms.filter((r) => r.floor !== targetFloor.id);
    next = {
      ...next,
      rooms: [...otherFloors, ...stampedRooms],
    };
  }
  if (options.placeSpawnInMainRoom) {
    const pos = pickMainRoomSpawn(stamp.rooms, doc.width, doc.height);
    next = {
      ...next,
      spawn: { x: pos.x, y: pos.y, floor: targetFloor.id },
    };
  }
  if (options.placeRoomLights) {
    const lightOpts = options.roomLightOptions ?? {};
    // Floor-scoped default prefix keeps light ids unique across multi-floor Generate.
    const stampLights = lightsFromDungeonRooms(stamp.rooms, targetFloor.id, {
      ...lightOpts,
      idPrefix: lightOpts.idPrefix ?? `stamp-light-${targetFloor.id}`,
    });
    next = {
      ...next,
      lights: mergeStampRoomLights(next.lights, targetFloor.id, stampLights),
    };
  }
  if (options.placePlayerTorch) {
    next = {
      ...next,
      lights: ensurePlayerTorch(next.lights, options.playerTorchOptions ?? {}),
    };
  }
  if (options.placeStairToAdjacentFloor) {
    const adjacentIndex = pickAdjacentFloorIndex(targetFloorIndex, doc.floors.length);
    if (adjacentIndex !== undefined) {
      const adjacentFloor = doc.floors[adjacentIndex];
      if (adjacentFloor) {
        const entry = pickMainRoomSpawn(stamp.rooms, doc.width, doc.height);
        const exit = roomLandingTile(next.rooms, adjacentFloor.id, doc.width, doc.height);
        const link = stampStairLinkBetween(
          targetFloor.id,
          entry,
          adjacentFloor.id,
          exit,
        );
        next = {
          ...next,
          stairLinks: mergeStampStairLinks(
            next.stairLinks,
            targetFloor.id,
            adjacentFloor.id,
            link,
          ),
        };
      }
    }
  }
  return next;
}
