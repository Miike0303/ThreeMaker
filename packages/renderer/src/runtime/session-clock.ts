/**
 * Pure session-clock helpers (C7 WU-02). Kept free of DOM / three so vitest
 * can drive them under `environment: 'node'`.
 *
 * The live `WorldClock` instance lives on the narrative root; these helpers
 * are the testable seams main.ts calls for tick writes, save re-sync, and
 * debug formatting.
 */

import { MINUTES_PER_DAY, type WorldClock } from '@threemaker/core';

/** World-state key for the simulated clock (one write per crossed minute). */
export const CLOCK_MINUTES_KEY = 'clock.minutes';

/**
 * Format whole minutes-of-day as `HH:MM` (zero-padded). Expects an integer in
 * `[0, 1440)`; out-of-range values still format via modular wrap so the debug
 * panel never throws on a bad snapshot.
 */
export function formatClockMinutes(minutes: number): string {
  const wrapped =
    Number.isFinite(minutes) && Number.isInteger(minutes)
      ? ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
      : 0;
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** True when `value` is a whole minute in `[0, 1440)`. */
export function isValidClockMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MINUTES_PER_DAY
  );
}

/**
 * Rehydrate the live clock from a world snapshot value (save load).
 * Valid minute → `setMinutes` and return true; absent/invalid → leave the
 * clock untouched and return false (old saves have no `clock.minutes`).
 */
export function resyncClockFromWorldValue(
  clock: Pick<WorldClock, 'setMinutes'>,
  value: unknown,
): boolean {
  if (!isValidClockMinutes(value)) return false;
  clock.setMinutes(value);
  return true;
}

export interface SessionClockWorld {
  set(key: string, value: number): void;
}

/**
 * Advance the session clock by `dtSeconds`. When one or more whole minutes
 * cross, writes `clock.minutes` ONCE with the final minute (never per frame,
 * and never once-per-crossed-minute). Intermediate values are useless:
 * no listener needs them and scripts always read the current time.
 *
 * @returns How many whole minute boundaries were crossed (0..n).
 */
export function tickSessionClock(
  clock: Pick<WorldClock, 'advance' | 'minutes'>,
  world: SessionClockWorld,
  dtSeconds: number,
): number {
  const crossed = clock.advance(dtSeconds);
  if (crossed > 0) {
    // One write with the final minute when multiple minutes cross in one tick:
    // no listener needs intermediate values; scripts read current time.
    world.set(CLOCK_MINUTES_KEY, clock.minutes);
  }
  return crossed;
}
