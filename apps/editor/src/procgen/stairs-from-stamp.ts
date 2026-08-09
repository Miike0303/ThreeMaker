/**
 * Build stair-links for multi-floor procgen (WU-PROC-18).
 * Pure — used by applyDungeonStampToMapDocument when placeStairToAdjacentFloor is on.
 */
import type { RoomDocument, StairLinkDocument } from '@threemaker/map-format';
import { roomArea } from '../entity-lists.js';

/** Prefer the floor below the target; ground links upward when an upper floor exists. */
export function pickAdjacentFloorIndex(
  targetIndex: number,
  floorCount: number,
): number | undefined {
  if (!Number.isInteger(targetIndex) || !Number.isInteger(floorCount)) return undefined;
  if (floorCount < 2 || targetIndex < 0 || targetIndex >= floorCount) return undefined;
  if (targetIndex > 0) return targetIndex - 1;
  return 1;
}

/**
 * Landing tile for stairs on `floorId`: center of the largest room's first rect.
 * Empty floor → map center (same fallback as pickMainRoomSpawn).
 */
export function roomLandingTile(
  rooms: readonly RoomDocument[],
  floorId: string,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  const mapCenter = {
    x: Math.min(Math.max(0, width - 1), Math.max(0, Math.floor(width / 2))),
    y: Math.min(Math.max(0, height - 1), Math.max(0, Math.floor(height / 2))),
  };
  const onFloor = rooms.filter((room) => room.floor === floorId);
  if (onFloor.length === 0) return mapCenter;

  let best = onFloor[0]!;
  let bestArea = roomArea(best);
  for (let i = 1; i < onFloor.length; i++) {
    const room = onFloor[i]!;
    const area = roomArea(room);
    if (area > bestArea) {
      best = room;
      bestArea = area;
    }
  }
  const rect = best.rects[0];
  if (!rect) return mapCenter;
  return {
    x: Math.min(width - 1, Math.max(0, rect.x + Math.floor(rect.width / 2))),
    y: Math.min(height - 1, Math.max(0, rect.y + Math.floor(rect.height / 2))),
  };
}

export type StampStairLinkOptions = {
  readonly id?: string;
  readonly bidirectional?: boolean;
};

/** Two-waypoint stair from entry on fromFloor to exit on toFloor. */
export function stampStairLinkBetween(
  fromFloor: string,
  entry: { readonly x: number; readonly y: number },
  toFloor: string,
  exit: { readonly x: number; readonly y: number },
  options: StampStairLinkOptions = {},
): StairLinkDocument {
  return {
    id: options.id ?? `stamp-stair-${fromFloor}-${toFloor}`,
    fromFloor,
    toFloor,
    bidirectional: options.bidirectional ?? true,
    waypoints: [
      { x: entry.x, y: entry.y, floor: fromFloor },
      { x: exit.x, y: exit.y, floor: toFloor },
    ],
  };
}

function linksConnectFloors(
  link: StairLinkDocument,
  floorA: string,
  floorB: string,
): boolean {
  return (
    (link.fromFloor === floorA && link.toFloor === floorB) ||
    (link.fromFloor === floorB && link.toFloor === floorA)
  );
}

/**
 * Drop any existing links for the floor pair (either direction), then append
 * `stampLink` when defined. Re-Generate stays one stamp stair per adjacency.
 */
export function mergeStampStairLinks(
  existing: readonly StairLinkDocument[],
  floorA: string,
  floorB: string,
  stampLink: StairLinkDocument | undefined,
): readonly StairLinkDocument[] {
  const kept = existing.filter((link) => !linksConnectFloors(link, floorA, floorB));
  return stampLink === undefined ? kept : [...kept, stampLink];
}

/** Default id prefix from `stampStairLinkBetween` (success toast / filters). */
export const STAMP_STAIR_ID_PREFIX = 'stamp-stair-';

/** Count procgen-authored stair links (id prefix match). */
export function countStampStairLinks(links: readonly StairLinkDocument[]): number {
  let count = 0;
  for (const link of links) {
    if (link.id.startsWith(STAMP_STAIR_ID_PREFIX)) count += 1;
  }
  return count;
}
