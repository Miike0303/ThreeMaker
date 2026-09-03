/**
 * Pure list helpers for Map / Entities inspectors (rooms, props list-place).
 * Keeps floor filtering and object-library order out of React components.
 */
import type {
  LightDocument,
  NpcDocument,
  NpcFacing,
  PropDocument,
  RoomDocument,
  StairLinkDocument,
  TriggerDocument,
} from '@threemaker/map-format';
import { clampRange } from './clamp.js';

/** Filter any floor-scoped entity list (rooms, props, npcs, triggers). */
export function entitiesOnFloor<T extends { readonly floor: string }>(
  entities: readonly T[],
  floorId: string | undefined,
): readonly T[] {
  if (floorId === undefined) return [];
  return entities.filter((entity) => entity.floor === floorId);
}

/**
 * Keep only entities whose `floor` is still in the floor stack (WU-UTIL-06).
 * Returns the same array reference when nothing was dropped.
 */
export function entitiesOnKnownFloors<T extends { readonly floor: string }>(
  entities: readonly T[],
  floorIds: ReadonlySet<string>,
): readonly T[] {
  const next = entities.filter((entity) => floorIds.has(entity.floor));
  return next.length === entities.length ? entities : next;
}

/**
 * Drop stair-links that reference a missing floor id (from or to).
 * Returns the same array reference when nothing was dropped.
 */
export function pruneStairLinksForFloors(
  links: readonly StairLinkDocument[],
  floorIds: ReadonlySet<string>,
): readonly StairLinkDocument[] {
  const next = links.filter((link) => floorIds.has(link.fromFloor) && floorIds.has(link.toFloor));
  return next.length === links.length ? links : next;
}

/**
 * Drop placed lights whose `floor` is gone. Attached lights (no floor) pass.
 * Pair with `pruneLightsForNpcs` after NPCs on removed floors are filtered.
 */
export function pruneLightsForFloors(
  lights: readonly LightDocument[],
  floorIds: ReadonlySet<string>,
): readonly LightDocument[] {
  const next = lights.filter(
    (light) =>
      light.attach !== undefined || (light.floor !== undefined && floorIds.has(light.floor)),
  );
  return next.length === lights.length ? lights : next;
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
  readonly scale: number;
  readonly rotationY: number;
  readonly animation: string;
};

export function propPlacementFromDocument(prop: PropDocument): PropPlacementBrush {
  return {
    object: prop.object,
    scale: prop.scale ?? 1,
    rotationY: prop.rotationY ?? 0,
    animation: prop.animation ?? '',
  };
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

/**
 * Placed lights on a floor (schema v6). Attached lights (`attach` only) have no
 * floor and are excluded — use `attachedLights` for those.
 */
export function lightsOnFloor(
  lights: readonly LightDocument[],
  floorId: string | undefined,
): readonly LightDocument[] {
  if (floorId === undefined) return [];
  return lights.filter((light) => light.floor === floorId);
}

/** Lights with the attached form (`attach` set; no floor/x/y). Document-wide. */
export function attachedLights(lights: readonly LightDocument[]): readonly LightDocument[] {
  return lights.filter((light) => light.attach !== undefined);
}

/**
 * Valid attach targets for a new attached light: always `'player'`, then every
 * authored NPC id in document order (schema: attach is player or npc id).
 */
export function lightAttachTargets(npcs: readonly NpcDocument[]): readonly string[] {
  return ['player', ...npcs.map((npc) => npc.id)];
}

/** Placement brush fields copied from an authored light (list-place reuse). */
export type LightPlacementBrush = {
  readonly kind: LightDocument['kind'];
  readonly color: string;
  readonly intensity: number;
  readonly range: number;
  /** World-Y offset; schema omittable (=1 at runtime). */
  readonly height: number;
};

export function lightPlacementFromDocument(light: LightDocument): LightPlacementBrush {
  return {
    kind: light.kind,
    color: light.color,
    intensity: light.intensity,
    range: light.range,
    height: light.height ?? 1,
  };
}

/** Lowercase `#rrggbb` or undefined when invalid (schema LIGHT_COLOR_RE). */
export function normalizeLightColor(raw: string): string | undefined {
  const color = raw.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) return undefined;
  return color;
}

/** Authoring soft bounds for light brush (schema only requires finite > 0 / >= 0). */
export const LIGHT_INTENSITY_MIN = 0.01;
export const LIGHT_INTENSITY_MAX = 50;
export const LIGHT_RANGE_MIN = 0.01;
export const LIGHT_RANGE_MAX = 64;
export const LIGHT_HEIGHT_MIN = 0;
export const LIGHT_HEIGHT_MAX = 32;

/**
 * Soft-clamp intensity into authoring bounds. Non-finite or `<= 0` → undefined
 * (caller no-ops). Tiny positive values lift to MIN; huge values cap at MAX.
 */
export function clampLightIntensity(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return clampRange(value, LIGHT_INTENSITY_MIN, LIGHT_INTENSITY_MAX);
}

/** Soft-clamp range (world units); same invalid contract as intensity. */
export function clampLightRange(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return clampRange(value, LIGHT_RANGE_MIN, LIGHT_RANGE_MAX);
}

/** Soft-clamp height (world-Y offset); non-finite or `< 0` → undefined. */
export function clampLightHeight(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return clampRange(value, LIGHT_HEIGHT_MIN, LIGHT_HEIGHT_MAX);
}

/**
 * Drop attached lights whose `attach` is neither `'player'` nor an existing
 * NPC id (schema would reject dangling attach on parse). Placed lights pass
 * through unchanged.
 */
export function pruneLightsForNpcs(
  lights: readonly LightDocument[],
  npcs: readonly NpcDocument[],
): readonly LightDocument[] {
  const npcIds = new Set(npcs.map((npc) => npc.id));
  const next = lights.filter(
    (light) => light.attach === undefined || light.attach === 'player' || npcIds.has(light.attach),
  );
  return next.length === lights.length ? lights : next;
}
