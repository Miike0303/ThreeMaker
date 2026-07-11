/**
 * Decides which floor indices must have live rendering right now, given the
 * player's current floor and the building's total floor count (design
 * "Render policy" -- Plantas Apiladas change). Deliberately a swappable
 * interface, not a concrete rule baked into the renderer: this slice ships
 * `WindowedFloorPolicy` as a stopgap; a later change substitutes an
 * occlusion-aware policy here with zero changes to any renderer code outside
 * this boundary.
 *
 * Implementations must never return an index outside `[0, floorCount)`.
 */
export interface FloorVisibilityPolicy {
  /**
   * Returns the floor indices that must render for `currentFloor` in a
   * building of `floorCount` floors (valid indices `0..floorCount-1`).
   */
  visibleFloors(currentFloor: number, floorCount: number): readonly number[];
}

/**
 * Default render-window stopgap: renders only `currentFloor` and
 * `currentFloor - 1`, NEVER `currentFloor + 1`. `currentFloor - 1` is simply
 * omitted (not clamped to 0) when it would be negative -- there is no floor
 * below the ground floor. Switching the active floor re-derives the window
 * from scratch on the next call; callers apply the result by disposing
 * floors that fall out of the window and building fresh ones for floors that
 * enter it (see main.ts's `applyFloorWindow`).
 */
export class WindowedFloorPolicy implements FloorVisibilityPolicy {
  visibleFloors(currentFloor: number, floorCount: number): readonly number[] {
    const floors: number[] = [];
    const below = currentFloor - 1;
    if (below >= 0 && below < floorCount) floors.push(below);
    if (currentFloor >= 0 && currentFloor < floorCount) floors.push(currentFloor);
    return floors;
  }
}
