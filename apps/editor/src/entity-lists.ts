/**
 * Pure list helpers for Map / Entities inspectors (rooms, props list-place).
 * Keeps floor filtering and object-library order out of React components.
 */
import type {
  NpcDocument,
  NpcFacing,
  PropDocument,
  RoomDocument,
  TriggerDocument,
} from '@threemaker/map-format';

/** Filter any floor-scoped entity list (rooms, props, npcs, triggers). */
export function entitiesOnFloor<T extends { readonly floor: string }>(
  entities: readonly T[],
  floorId: string | undefined,
): readonly T[] {
  if (floorId === undefined) return [];
  return entities.filter((entity) => entity.floor === floorId);
}

/** Sum of rect areas for a room (ties and empty rects allowed). */
export function roomArea(room: RoomDocument): number {
  let area = 0;
  for (const rect of room.rects) {
    area += Math.max(0, rect.width) * Math.max(0, rect.height);
  }
  return area;
}

/**
 * Largest room by total rect area; first in list wins ties.
 * Empty input → undefined (caller leaves selection cleared).
 */
export function pickMainRoomId(rooms: readonly RoomDocument[]): string | undefined {
  if (rooms.length === 0) return undefined;
  let best = rooms[0]!;
  let bestArea = roomArea(best);
  for (let i = 1; i < rooms.length; i++) {
    const room = rooms[i]!;
    const area = roomArea(room);
    if (area > bestArea) {
      best = room;
      bestArea = area;
    }
  }
  return best.id;
}

/** Rooms on a floor, stable document order. */
export function roomsOnFloor(
  rooms: readonly RoomDocument[],
  floorId: string | undefined,
): readonly RoomDocument[] {
  return entitiesOnFloor(rooms, floorId);
}

/** Placed props on a floor, stable document order. */
export function propsOnFloor(
  props: readonly PropDocument[],
  floorId: string | undefined,
): readonly PropDocument[] {
  return entitiesOnFloor(props, floorId);
}

/** Placed NPCs on a floor, stable document order. */
export function npcsOnFloor(
  npcs: readonly NpcDocument[],
  floorId: string | undefined,
): readonly NpcDocument[] {
  return entitiesOnFloor(npcs, floorId);
}

/** Placed triggers on a floor, stable document order. */
export function triggersOnFloor(
  triggers: readonly TriggerDocument[],
  floorId: string | undefined,
): readonly TriggerDocument[] {
  return entitiesOnFloor(triggers, floorId);
}

/** Placement brush fields copied from an authored NPC (list-place reuse). */
export type NpcPlacementBrush = {
  readonly spriteObject: string;
  readonly characterIndex: number;
  readonly facing: NpcFacing;
  readonly eventKey: string;
};

export function npcPlacementFromDocument(npc: NpcDocument): NpcPlacementBrush {
  return {
    spriteObject: npc.sprite.object,
    characterIndex: npc.sprite.characterIndex,
    facing: npc.facing,
    eventKey: npc.onInteract,
  };
}

/** Placement brush fields copied from an authored trigger (list-place reuse). */
export type TriggerPlacementBrush = {
  readonly on: 'enter' | 'interact';
  readonly eventKey: string;
};

export function triggerPlacementFromDocument(trigger: TriggerDocument): TriggerPlacementBrush {
  return {
    on: trigger.on,
    eventKey: trigger.event,
  };
}

/** Placement brush fields copied from an authored prop (list-place reuse). */
export type PropPlacementBrush = {
  readonly object: string;
};

export function propPlacementFromDocument(prop: PropDocument): PropPlacementBrush {
  return { object: prop.object };
}

/**
 * Unique prop object shas for U2U-style list-place library.
 * Order: active first (if non-empty), then first-seen order from placed props.
 */
export function propObjectLibrary(
  props: readonly PropDocument[],
  activeObject?: string,
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (sha: string | undefined) => {
    if (sha === undefined) return;
    const trimmed = sha.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  push(activeObject);
  for (const prop of props) {
    push(prop.object);
  }
  return out;
}
