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

/**
 * Occlusion-aware render window (design "Ceilings and Interior Occlusion"):
 * renders `[currentFloor - 1, currentFloor, currentFloor + 1]`, clamped to
 * `[0, floorCount)`, so the floor ABOVE the player is present and rendered
 * OPAQUE (not omitted) -- the floor above's own geometry is what occludes
 * the exterior/upper interior from the HD-2D/top-down camera. This replaces
 * `WindowedFloorPolicy`'s never-render-`currentFloor+1` rule; that class is
 * kept in place (not deleted) purely for rollback -- swapping the concrete
 * policy in `main.ts`'s `applyFloorWindow` is the entire migration path.
 *
 * Traversal pinning (`pinnedFloor = max(fromFloor, toFloor)`) still holds:
 * `[pinnedFloor - 1, pinnedFloor, pinnedFloor + 1]` always includes
 * `pinnedFloor - 1`, so an adjacent-floor stair link's source floor never
 * disposes mid-climb. Non-adjacent links remain uncovered, exactly as
 * before this change -- a pre-existing, documented assumption that this
 * policy does not widen.
 */
export class OcclusionFloorPolicy implements FloorVisibilityPolicy {
  visibleFloors(currentFloor: number, floorCount: number): readonly number[] {
    const floors: number[] = [];
    for (const candidate of [currentFloor - 1, currentFloor, currentFloor + 1]) {
      if (candidate >= 0 && candidate < floorCount) floors.push(candidate);
    }
    return floors;
  }
}
