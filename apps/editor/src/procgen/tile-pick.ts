/**
 * Heuristics for choosing ground/wall tile ids from the live map + brush.
 * Pure — no DOM / catalog IO.
 */

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
 * Resolve ground + wall tile ids for a dungeon stamp.
 * Preference: brush fill for ground → majority on layer 0 → fallback.
 * Wall: majority on layer 2 if distinct from ground → fallback wall id.
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
}): { readonly groundTileId: number; readonly wallTileId: number } {
  const fromFill = input.fillTileId > 0 ? input.fillTileId : undefined;
  const fromGround = majorityNonZeroTileId(input.groundLayer);
  const groundTileId = fromFill ?? fromGround ?? input.fallbackGround;

  const override =
    input.wallTileOverride !== undefined && input.wallTileOverride > 0
      ? input.wallTileOverride
      : undefined;
  const fromWall = majorityNonZeroTileId(input.wallLayer);
  let wallTileId =
    override ??
    (fromWall !== undefined && fromWall !== groundTileId ? fromWall : input.fallbackWall);
  if (wallTileId === 0 || (wallTileId === groundTileId && input.fallbackWall !== groundTileId)) {
    wallTileId = input.fallbackWall !== groundTileId ? input.fallbackWall : groundTileId;
  }
  // Last resort: still need a non-zero wall; allow same as ground (looks flat but valid).
  if (wallTileId === 0) wallTileId = groundTileId;

  return { groundTileId, wallTileId };
}
