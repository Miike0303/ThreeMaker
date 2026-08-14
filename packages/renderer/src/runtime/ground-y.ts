import type { ElevationField } from '@threemaker/gameplay';

/**
 * World-space Y of the ground a character/NPC/camera should sit at, given a
 * (possibly fractional) tile position, the ACTIVE floor's `ElevationField`,
 * and that floor's `baseElevation` (design: "worldY = (floor.baseElevation +
 * elevation.surfaceHeightAt(fx,fy)) * HEIGHT_UNIT"). Reads
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
 *
 * `baseElevation` defaults to `0` (floor 0 / every pre-stacked-floors
 * caller) so the composed Y matches this floor's own render group, which
 * `main.ts`'s `buildFloorRender` offsets by the SAME `baseElevation *
 * heightUnit` term (`tilemap.group.position.y = source.baseElevation *
 * HEIGHT_UNIT`) -- omitting this term here would leave the character
 * sprite/camera sitting on floor 0's Y while the active floor's tilemap
 * renders above it.
 */
export function groundYAt(
  elevation: ElevationField,
  tileX: number,
  tileY: number,
  heightUnit: number,
  baseElevation = 0,
): number {
  return (baseElevation + elevation.surfaceHeightAt(tileX, tileY)) * heightUnit;
}
