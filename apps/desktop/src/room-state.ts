import type { CameraMode } from './camera-rig.js';

/**
 * Per-floor room-id lookup (design "Player-current-room runtime"): given the
 * player's floor index and tile, resolves which authored room (if any) the
 * player currently stands in. `grids[floorIndex]` is that floor's own
 * `computeRoomIdGrid` output (`@threemaker/map-format`) -- 0 = no room at
 * that cell, else a 1-based room ordinal (per-floor-scoped, see
 * `apply-progress-s1`'s ordinal-scoping note). A missing entry (`undefined`,
 * a floor with no authored rooms -- mirrors `FloorSource.rampCells`'s "no
 * ramp" default) behaves exactly like an all-zero grid: `roomAt` always
 * resolves to 0.
 */
export interface RoomTracker {
  /** O(1) lookup: `grids[floorIndex]`'s value at `(x, y)`, or 0 when there is no grid, or `(x, y)` is unauthored/out of bounds. */
  roomAt(floorIndex: number, x: number, y: number): number;
}

/** Builds a `RoomTracker` over one room-id grid per floor, all sharing the same map `width` (design: "floors share the document's width/height"). */
export function createRoomTracker(
  grids: readonly (Uint16Array | undefined)[],
  width: number,
): RoomTracker {
  return {
    roomAt(floorIndex, x, y) {
      const grid = grids[floorIndex];
      if (!grid || width <= 0 || x < 0 || y < 0) return 0;
      return grid[y * width + x] ?? 0;
    },
  };
}

/**
 * Minimal shape `driveRoomFade`/`aboveFloorTilemap` need from a floor's
 * `StreamingTilemapScene` -- kept structural (not importing
 * `@threemaker/renderer`'s class) so this module stays free of a runtime
 * renderer dependency for unit tests; a plain mock object satisfies this.
 */
export interface FadeableTilemap {
  setFadedRoom(roomId: number | null): void;
  updateFade(dt: number): void;
}

/** The subset of `main.ts`'s `FloorRenderSlot` that `aboveFloorTilemap` needs. */
export interface FadeableFloorSlot {
  readonly render: { readonly tilemap: FadeableTilemap } | undefined;
}

/**
 * Resolves which floor's scene should be driven to fade the CURRENT floor's
 * rooms (design gotcha, obs #117 / apply-progress-s3b): floor i's ceiling is
 * built by carving floor (i-1)'s room grid into floor i's own
 * `StreamingTilemapScene`, so "fade the room the player is standing in"
 * means driving `floorSlots[floorIndex + 1]` -- the scene ONE FLOOR ABOVE
 * the player -- never `floorIndex` itself. Returns `undefined` when there is
 * no floor above (top floor, single-floor maps, or the floor above happens
 * to be outside the current render window) -- there is nothing to fade.
 */
export function aboveFloorTilemap(
  floorSlots: readonly FadeableFloorSlot[],
  floorIndex: number,
): FadeableTilemap | undefined {
  return floorSlots[floorIndex + 1]?.render?.tilemap;
}

/**
 * Applies the camera-mode gate (design "Player-current-room runtime"): only
 * `'hd2d'` and `'top-down'` ever fade a room's ceiling. `'first-person'`
 * ALWAYS resolves to `null` regardless of which room the player physically
 * stands in -- the camera sits under the ceiling looking out, so it must
 * always read as solid, not whatever room the character happens to be in.
 * An unauthored tile (`roomId === 0`) resolves to `null` in every mode.
 */
export function resolveFadedRoomId(cameraMode: CameraMode, roomId: number): number | null {
  if (cameraMode === 'first-person') return null;
  return roomId > 0 ? roomId : null;
}

/**
 * Drives one tick of the floor-above scene's ceiling fade: records the
 * target room (`setFadedRoom`) then advances the tween (`updateFade`),
 * matching the two-call shape `StreamingTilemapScene` exposes (obs #117). A
 * no-op when there is no floor-above tilemap to drive (see
 * `aboveFloorTilemap`) -- nothing to fade, so nothing is called. `roomId` is
 * expected to already be gated (`resolveFadedRoomId`, or forced to `null`
 * during stair traversal per design branch (b)).
 */
export function driveRoomFade(
  aboveTilemap: FadeableTilemap | undefined,
  roomId: number | null,
  dt: number,
): void {
  if (!aboveTilemap) return;
  aboveTilemap.setFadedRoom(roomId);
  aboveTilemap.updateFade(dt);
}
