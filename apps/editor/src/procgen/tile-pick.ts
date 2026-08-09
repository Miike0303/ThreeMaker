/**
 * Heuristics for choosing ground/wall tile ids from the live map + brush.
 * Pure — no DOM / catalog IO.
 */

import type { SemanticClass, SemanticOverrides } from '@threemaker/map-format';
import { getSemanticClass } from '../semantic-store.js';

/** Most common non-zero tile id in a layer, or `undefined` if empty. */
export function majorityNonZeroTileId(layer: readonly number[]): number | undefined {
  const counts = new Map<number, number>();
  let bestId: number | undefined;
  let bestCount = 0;
  for (const id of layer) {
    if (id === 0) continue;
    const next = (counts.get(id) ?? 0) + 1;
    counts.set(id, next);
    if (next > bestCount) {
      bestCount = next;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Most common non-zero id on `layer` whose semantic class is `wall`, if any.
 */
export function majorityWallClassedTileId(
  layer: readonly number[],
  semantics: SemanticOverrides,
): number | undefined {
  const counts = new Map<number, number>();
  let bestId: number | undefined;
  let bestCount = 0;
  for (const id of layer) {
    if (id === 0) continue;
    if (getSemanticClass(semantics, id) !== 'wall') continue;
    const next = (counts.get(id) ?? 0) + 1;
    counts.set(id, next);
    if (next > bestCount) {
      bestCount = next;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * First tile id (ascending) marked with `cls` in semantics, excluding
 * `excludeId` when set.
 */
export function firstClassedTileId(
  semantics: SemanticOverrides,
  cls: SemanticClass,
  excludeId?: number,
): number | undefined {
  let best: number | undefined;
  for (const key of Object.keys(semantics)) {
    const id = Number(key);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (excludeId !== undefined && id === excludeId) continue;
    if (getSemanticClass(semantics, id) !== cls) continue;
    if (best === undefined || id < best) best = id;
  }
  return best;
}

/**
 * First tile id (ascending) marked `class: 'wall'` in semantics, excluding
 * `excludeId` when set. Used when the wall layer is empty but the author
 * already tagged wall tiles elsewhere.
 */
export function firstWallClassedTileId(
  semantics: SemanticOverrides,
  excludeId?: number,
): number | undefined {
  return firstClassedTileId(semantics, 'wall', excludeId);
}

/**
 * Resolve ground + wall tile ids for a dungeon stamp.
 * Preference: brush fill for ground → majority on layer 0 → fallback.
 * Wall: override → wall-class majority on layer 2 → any wall-classed semantic
 * → layer-2 majority if distinct from ground → fallback wall id.
 * Door: override → first door-classed semantic id (optional; omitted when none).
 */
export function resolveDungeonTileIds(input: {
  readonly fillTileId: number;
  readonly groundLayer: readonly number[];
  readonly wallLayer: readonly number[];
  readonly fallbackGround: number;
  readonly fallbackWall: number;
  /**
   * Explicit wall tile from the UI picker. When > 0, wins over layer majority
   * (still falls back if zero).
   */
  readonly wallTileOverride?: number;
  /**
   * Explicit door tile from the UI picker. When > 0 and distinct from
   * ground/wall, wins over door-class semantics.
   */
  readonly doorTileOverride?: number;
  /**
   * Explicit furniture tile. When > 0 and distinct from ground/wall/door,
   * wins over furniture-class semantics.
   */
  readonly furnitureTileOverride?: number;
  /** Optional live map semantics for wall/door/furniture-class preference. */
  readonly semantics?: SemanticOverrides;
}): {
  readonly groundTileId: number;
  readonly wallTileId: number;
  readonly doorTileId?: number;
  readonly furnitureTileId?: number;
} {
  const semantics = input.semantics ?? {};
  const fromFill = input.fillTileId > 0 ? input.fillTileId : undefined;
  const fromGround = majorityNonZeroTileId(input.groundLayer);
  const groundTileId = fromFill ?? fromGround ?? input.fallbackGround;

  const override =
    input.wallTileOverride !== undefined && input.wallTileOverride > 0
      ? input.wallTileOverride
      : undefined;

  const fromWallClassLayer = majorityWallClassedTileId(input.wallLayer, semantics);
  const fromWallSemantics = firstWallClassedTileId(semantics, groundTileId);
  const fromWall = majorityNonZeroTileId(input.wallLayer);
  const fromWallIfDistinct =
    fromWall !== undefined && fromWall !== groundTileId ? fromWall : undefined;

  // Prefer an already wall-classed majority on the layer over a bare majority
  // that may be furniture/props mis-painted on layer 2.
  const wallFromSemantics =
    (fromWall !== undefined && getSemanticClass(semantics, fromWall) === 'wall'
      ? fromWall
      : undefined) ??
    fromWallClassLayer ??
    fromWallSemantics;

  let wallTileId = override ?? wallFromSemantics ?? fromWallIfDistinct ?? input.fallbackWall;
  if (wallTileId === 0 || (wallTileId === groundTileId && input.fallbackWall !== groundTileId)) {
    wallTileId = input.fallbackWall !== groundTileId ? input.fallbackWall : groundTileId;
  }
  // Last resort: still need a non-zero wall; allow same as ground (looks flat but valid).
  if (wallTileId === 0) wallTileId = groundTileId;

  const doorOverride =
    input.doorTileOverride !== undefined &&
    input.doorTileOverride > 0 &&
    input.doorTileOverride !== groundTileId &&
    input.doorTileOverride !== wallTileId
      ? input.doorTileOverride
      : undefined;
  const doorFromSemantics = firstClassedTileId(semantics, 'door', groundTileId);
  const doorFromSemanticsOk =
    doorFromSemantics !== undefined &&
    doorFromSemantics !== wallTileId &&
    doorFromSemantics > 0
      ? doorFromSemantics
      : undefined;
  const doorTileId = doorOverride ?? doorFromSemanticsOk;

  const furnitureOverride =
    input.furnitureTileOverride !== undefined &&
    input.furnitureTileOverride > 0 &&
    input.furnitureTileOverride !== groundTileId &&
    input.furnitureTileOverride !== wallTileId &&
    input.furnitureTileOverride !== doorTileId
      ? input.furnitureTileOverride
      : undefined;
  const furnitureFromSemantics = firstClassedTileId(semantics, 'furniture', groundTileId);
  const furnitureFromSemanticsOk =
    furnitureFromSemantics !== undefined &&
    furnitureFromSemantics > 0 &&
    furnitureFromSemantics !== wallTileId &&
    furnitureFromSemantics !== doorTileId
      ? furnitureFromSemantics
      : undefined;
  const furnitureTileId = furnitureOverride ?? furnitureFromSemanticsOk;

  const result: {
    groundTileId: number;
    wallTileId: number;
    doorTileId?: number;
    furnitureTileId?: number;
  } = { groundTileId, wallTileId };
  if (doorTileId !== undefined) result.doorTileId = doorTileId;
  if (furnitureTileId !== undefined) result.furnitureTileId = furnitureTileId;
  return result;
}
