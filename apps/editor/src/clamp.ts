// Copied from apps/desktop/src/clamp.ts (same tiny pure utility, no shared
// package exists for it yet). Ponytail: extract to a shared package if a
// third app ever needs it.

/**
 * Clamps `value` into `[min, max]`. Normalizes an inverted range (`min > max`)
 * instead of throwing, and treats `NaN` as the range's lower bound.
 */
export function clampRange(value: number, min: number, max: number): number {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  if (Number.isNaN(value)) return lower;
  return Math.min(Math.max(value, lower), upper);
}

/**
 * Integer tile index in `[0, size)`. Floors non-integers, clamps OOB, and
 * returns `0` for non-finite values or non-positive `size` (empty map).
 */
export function clampTileIndex(value: number, size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.floor(clampRange(value, 0, size - 1));
}

/** Inclusive-bounds rectangle in tile space (schema `RoomRect` shape). */
export type TileRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Clamp a room rect into the map so schema validation cannot fail on save.
 * Floors non-integers; requires positive integer width/height after clamp.
 * Returns `undefined` when the map is empty or the rect cannot retain a
 * positive in-bounds footprint.
 */
export function clampRoomRect(
  rect: TileRect,
  mapWidth: number,
  mapHeight: number,
): TileRect | undefined {
  if (!Number.isFinite(mapWidth) || !Number.isFinite(mapHeight) || mapWidth < 1 || mapHeight < 1) {
    return undefined;
  }
  const mw = Math.floor(mapWidth);
  const mh = Math.floor(mapHeight);
  if (mw < 1 || mh < 1) return undefined;

  let width = Number.isFinite(rect.width) ? Math.floor(rect.width) : 0;
  let height = Number.isFinite(rect.height) ? Math.floor(rect.height) : 0;
  if (width <= 0 || height <= 0) return undefined;

  let x = Number.isFinite(rect.x) ? Math.floor(rect.x) : 0;
  let y = Number.isFinite(rect.y) ? Math.floor(rect.y) : 0;
  x = clampRange(x, 0, mw - 1);
  y = clampRange(y, 0, mh - 1);
  width = Math.min(width, mw - x);
  height = Math.min(height, mh - y);
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}
