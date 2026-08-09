/**
 * Pure list helpers for Map / Entities inspectors (rooms, props list-place).
 * Keeps floor filtering and object-library order out of React components.
 */
import type { PropDocument, RoomDocument } from '@threemaker/map-format';

/** Rooms on a floor, stable document order. */
export function roomsOnFloor(
  rooms: readonly RoomDocument[],
  floorId: string | undefined,
): readonly RoomDocument[] {
  if (floorId === undefined) return [];
  return rooms.filter((room) => room.floor === floorId);
}

/** Placed props on a floor, stable document order. */
export function propsOnFloor(
  props: readonly PropDocument[],
  floorId: string | undefined,
): readonly PropDocument[] {
  if (floorId === undefined) return [];
  return props.filter((prop) => prop.floor === floorId);
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
