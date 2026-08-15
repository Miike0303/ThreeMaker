/**
 * Dirty-region computation for scoped live updates (Slice 4 design: "Dirty
 * region = stroke rect +1 tile (autotile/cliff neighbors), expanded north
 * per column across contiguous star runs (starStack bases)"). Pure -- takes
 * plain tile-layer data, produces the chunk keys `buildChunks(onlyChunks)` /
 * `StreamingTilemapScene.patchChunks` should be given.
 */

import type { RpgmMap, RpgmTileset } from '@threemaker/importer-rpgm';
import { decodeTileFlags } from '@threemaker/importer-rpgm';
import type { TilePoint } from './tool-sm.js';

export interface TileRect {
  readonly xStart: number;
  readonly yStart: number;
  /** Exclusive. */
  readonly xEnd: number;
  /** Exclusive. */
  readonly yEnd: number;
}

/** Bounding box of `cells`, expanded by 1 tile on every side (autotile/cliff neighbor invalidation), clamped to `[0, width) x [0, height)`. Returns a zero-area rect (`xStart === xEnd`) for an empty `cells` input. */
export function computeDirtyTileRect(
  cells: readonly TilePoint[],
  width: number,
  height: number,
): TileRect {
  if (cells.length === 0) {
    return { xStart: 0, yStart: 0, xEnd: 0, yEnd: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const cell of cells) {
    if (cell.x < minX) minX = cell.x;
    if (cell.x > maxX) maxX = cell.x;
    if (cell.y < minY) minY = cell.y;
    if (cell.y > maxY) maxY = cell.y;
  }
  return {
    xStart: Math.max(0, minX - 1),
    yStart: Math.max(0, minY - 1),
    xEnd: Math.min(width, maxX + 2),
    yEnd: Math.min(height, maxY + 2),
  };
}

/** Whether any of the map's 4 tile layers has an upper-layer ("star") tile at `(x, y)`. */
function hasStarTileAt(map: RpgmMap, tileset: RpgmTileset, x: number, y: number): boolean {
  const index = y * map.width + x;
  for (const layer of map.layers.tileLayers) {
    const tileId = layer[index] ?? 0;
    if (tileId === 0) continue;
    if (decodeTileFlags(tileset.flags[tileId] ?? 0).isUpperLayer) return true;
  }
  return false;
}

/**
 * Expands `rect` northward (decreasing `yStart`), independently per column,
 * through any contiguous run of star ("upper layer") tiles immediately
 * above the rect's current top edge -- a star tile's rendered anchor/height
 * depends on the BASE tile it stacks on (see `computeStarStack` in
 * `@threemaker/renderer`), which sits south of it; editing that base must
 * also dirty every star tile stacked north of it, up to the first
 * non-star tile or the map's top edge.
 */
export function expandDirtyRectNorthThroughStars(
  rect: TileRect,
  map: RpgmMap,
  tileset: RpgmTileset,
): TileRect {
  if (rect.xStart >= rect.xEnd || rect.yStart >= rect.yEnd) return rect;

  let minYStart = rect.yStart;
  for (let x = rect.xStart; x < rect.xEnd; x++) {
    let y = rect.yStart - 1;
    while (y >= 0 && hasStarTileAt(map, tileset, x, y)) y--;
    const expandedYStart = y + 1;
    if (expandedYStart < minYStart) minYStart = expandedYStart;
  }
  return { ...rect, yStart: minYStart };
}

/** Every `"chunkX,chunkY"` key whose chunk overlaps `rect` (matching `chunkKey` in `@threemaker/renderer`'s streaming module). Empty for a zero-area rect. */
export function dirtyRectToChunkKeys(rect: TileRect, chunkSize: number): ReadonlySet<string> {
  const keys = new Set<string>();
  if (rect.xStart >= rect.xEnd || rect.yStart >= rect.yEnd) return keys;

  const chunkXStart = Math.floor(rect.xStart / chunkSize);
  const chunkXEnd = Math.floor((rect.xEnd - 1) / chunkSize);
  const chunkYStart = Math.floor(rect.yStart / chunkSize);
  const chunkYEnd = Math.floor((rect.yEnd - 1) / chunkSize);

  for (let chunkY = chunkYStart; chunkY <= chunkYEnd; chunkY++) {
    for (let chunkX = chunkXStart; chunkX <= chunkXEnd; chunkX++) {
      keys.add(`${chunkX},${chunkY}`);
    }
  }
  return keys;
}

/**
 * Union of each painted cell's +1-margin rect, rather than one bounding rect
 * over the whole stroke. Star expansion is computed once per distinct column
 * from that column's topmost painted cell — a per-cell walk would be
 * O(cells × map height) and a flood fill would get slower than the old AABB.
 *
 * Most cells cannot dirty anything but their own chunk: a ±1 rect only
 * crosses a boundary within 1 tile of one, and a flood fill's interior is
 * that thin frame's complement. Those cells add their own key and skip
 * per-cell rect/Set allocation. A column whose star expansion reaches above
 * a cell's chunk still takes the full path.
 */
export function computeDirtyChunkKeys(
  cells: readonly TilePoint[],
  map: RpgmMap,
  tileset: RpgmTileset,
  chunkSize: number,
): ReadonlySet<string> {
  const keys = new Set<string>();
  if (cells.length === 0) return keys;

  const minYByColumn = new Map<number, number>();
  const maxYByColumn = new Map<number, number>();
  for (const cell of cells) {
    const prevMin = minYByColumn.get(cell.x);
    if (prevMin === undefined || cell.y < prevMin) minYByColumn.set(cell.x, cell.y);
    const prevMax = maxYByColumn.get(cell.x);
    if (prevMax === undefined || cell.y > prevMax) maxYByColumn.set(cell.x, cell.y);
  }

  const expandedYStartByColumn = new Map<number, number>();
  for (const [x, minY] of minYByColumn) {
    const rect = computeDirtyTileRect([{ x, y: minY }], map.width, map.height);
    expandedYStartByColumn.set(x, expandDirtyRectNorthThroughStars(rect, map, tileset).yStart);
  }

  const needsFullColumn = new Set<number>();
  for (const cell of cells) {
    const { x, y } = cell;
    const chunkX = Math.floor(x / chunkSize);
    const chunkY = Math.floor(y / chunkSize);
    const chunkTopY = chunkY * chunkSize;
    const expandedYStart = expandedYStartByColumn.get(x) ?? Math.max(0, y - 1);

    if (
      Math.floor((x - 1) / chunkSize) === chunkX &&
      Math.floor((x + 1) / chunkSize) === chunkX &&
      Math.floor((y + 1) / chunkSize) === chunkY &&
      expandedYStart >= chunkTopY
    ) {
      keys.add(`${chunkX},${chunkY}`);
      continue;
    }

    needsFullColumn.add(x);
  }

  // Union of each remaining cell's stretched rect in a column is one rect
  // (same x±1, y from the column's expanded yStart to the lowest cell + 1).
  for (const x of needsFullColumn) {
    const minY = minYByColumn.get(x);
    const maxY = maxYByColumn.get(x);
    if (minY === undefined || maxY === undefined) continue;
    const rect = computeDirtyTileRect(
      [
        { x, y: minY },
        { x, y: maxY },
      ],
      map.width,
      map.height,
    );
    const expanded = {
      ...rect,
      yStart: expandedYStartByColumn.get(x) ?? rect.yStart,
    };
    for (const key of dirtyRectToChunkKeys(expanded, chunkSize)) keys.add(key);
  }
  return keys;
}
