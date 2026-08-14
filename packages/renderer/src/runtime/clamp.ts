/**
 * Clamps `value` into `[min, max]`. Normalizes an inverted range (`min > max`)
 * instead of throwing, and treats `NaN` as the range's lower bound. Shared by
 * unit-specific wrappers (camera tilt/distance, DoF focus distance) so the
 * defensive contract lives in exactly one place.
 */
export function clampRange(value: number, min: number, max: number): number {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  if (Number.isNaN(value)) return lower;
  return Math.min(Math.max(value, lower), upper);
}
