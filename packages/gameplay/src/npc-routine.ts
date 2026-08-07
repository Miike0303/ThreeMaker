import type { Direction } from './grid-mover.js';

/**
 * One stop on an NPC day routine. `at` is a whole minute in [0, 1440).
 * Pure resolution only — schema validation lives in map-format.
 */
export type RoutineStop = {
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly facing: Direction;
};

/**
 * Resolve where an NPC should stand at `minutes` given a base (authored)
 * position and an ordered routine.
 *
 * The active stop is the LAST entry whose `at <= minutes`. Before the first
 * entry's `at`, the NPC is at `base` (authored x/y/facing with `at: 0`
 * semantics).
 *
 * Wrap-around deliberately does NOT apply the day's last entry from
 * "yesterday": if `minutes` is before every entry's `at`, `base` wins. That
 * is the simplest deterministic rule for day boundaries.
 *
 * Pure — no validation (schema owns that).
 */
export function routinePositionAt(
  base: RoutineStop,
  routine: readonly RoutineStop[],
  minutes: number,
): RoutineStop {
  let active: RoutineStop | undefined;
  for (const stop of routine) {
    if (stop.at <= minutes) {
      active = stop;
    } else {
      break;
    }
  }
  return active ?? base;
}
