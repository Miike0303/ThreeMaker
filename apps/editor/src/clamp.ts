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
