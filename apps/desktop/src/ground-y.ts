import type { ElevationField } from '@threemaker/gameplay';

/**
 * World-space Y of the ground a character/NPC/camera should sit at, given a
 * (possibly fractional) tile position and the map's `ElevationField`. Reads
 * `elevation.surfaceHeightAt` directly, with no rounding to the nearest
 * tile, so a mid-step fractional position that crosses a ramp interpolates
 * continuously between the two connected heights instead of popping at
 * step completion (design doc "Ramps y Escaleras": "GridMover untouched ...
 * consumers compute y = surfaceHeightAt(renderPosition) * HEIGHT_UNIT").
 *
 * A flat (non-ramp) step is unaffected: `surfaceHeightAt` already returns a
 * constant across a flat cell regardless of fractional position (see
 * `ElevationField`'s own tests) -- this matches the pre-ramp behavior
 * byte-for-byte, since `PassabilityGrid.canMove` only ever allows a step
 * between two equal-height cells there. A teleport is unaffected too: it
 * snaps the mover's tile (and `renderPosition`) directly to an integer
 * destination, so there is no intermediate fractional position to
 * interpolate through -- this function just reads whatever position it is
 * given.
 */
export function groundYAt(
  elevation: ElevationField,
  tileX: number,
  tileY: number,
  heightUnit: number,
): number {
  return elevation.surfaceHeightAt(tileX, tileY) * heightUnit;
}
