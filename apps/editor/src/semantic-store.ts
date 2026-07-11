/**
 * Semantic-class assignment (Slice 4 design/spec: "Semantic-class painting
 * mode... assigns class independent of visual tile selection" / "Semantic-
 * only edit: painting over a tile changes its semantic class without
 * altering its visual tile reference"). Pure -- operates on
 * `@threemaker/map-format`'s `SemanticOverrides`, keyed by tile id (NOT map
 * cell position), matching the map format's schema.
 */

import type { SemanticClass, SemanticOverrides, TileSemanticEntry } from '@threemaker/map-format';
import type { TilePoint } from './tool-sm.js';

/** Every distinct tile id (excluding empty/0) painted over by `cells` on `layer`. */
export function resolveTouchedTileIds(
  cells: readonly TilePoint[],
  layer: readonly number[],
  width: number,
): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const cell of cells) {
    const tileId = layer[cell.y * width + cell.x] ?? 0;
    if (tileId !== 0) ids.add(tileId);
  }
  return ids;
}

/** Assigns `cls` to every id in `tileIds`, leaving every other entry (and the RPGM flag passthrough, which lives elsewhere) untouched. */
export function assignSemanticClass(
  semantics: SemanticOverrides,
  tileIds: ReadonlySet<number>,
  cls: SemanticClass,
): SemanticOverrides {
  if (tileIds.size === 0) return semantics;
  const next: Record<string, TileSemanticEntry> = { ...semantics };
  for (const tileId of tileIds) {
    next[String(tileId)] = { class: cls };
  }
  return next;
}

/** The semantic class for `tileId`, defaulting to `'none'` when no override exists (matches the map-format schema's documented default). */
export function getSemanticClass(semantics: SemanticOverrides, tileId: number): SemanticClass {
  return semantics[String(tileId)]?.class ?? 'none';
}
