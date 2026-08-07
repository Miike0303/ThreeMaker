import { describe, expect, it } from 'vitest';
import type { RoutineStop } from '../src/npc-routine.js';
import { routinePositionAt } from '../src/npc-routine.js';

const base: RoutineStop = { at: 0, x: 1, y: 1, facing: 'down' };

const morning: RoutineStop = { at: 480, x: 5, y: 5, facing: 'right' };
const noon: RoutineStop = { at: 720, x: 10, y: 2, facing: 'up' };
const evening: RoutineStop = { at: 1080, x: 3, y: 8, facing: 'left' };
const routine: readonly RoutineStop[] = [morning, noon, evening];

describe('routinePositionAt', () => {
  it('returns base before the first stop', () => {
    expect(routinePositionAt(base, routine, 0)).toEqual(base);
    expect(routinePositionAt(base, routine, 479)).toEqual(base);
  });

  it('returns the last passed stop between stops', () => {
    expect(routinePositionAt(base, routine, 480)).toEqual(morning);
    expect(routinePositionAt(base, routine, 500)).toEqual(morning);
    expect(routinePositionAt(base, routine, 719)).toEqual(morning);
    expect(routinePositionAt(base, routine, 720)).toEqual(noon);
    expect(routinePositionAt(base, routine, 900)).toEqual(noon);
  });

  it('returns the last stop after the last entry', () => {
    expect(routinePositionAt(base, routine, 1080)).toEqual(evening);
    expect(routinePositionAt(base, routine, 1439)).toEqual(evening);
  });

  it('returns base at the day wrap before the first at (no yesterday carry)', () => {
    // After evening (last stop), a new day at minutes=0..479 is base, not evening.
    expect(routinePositionAt(base, routine, 0)).toEqual(base);
    expect(routinePositionAt(base, routine, 100)).toEqual(base);
  });

  it('returns base when the routine is empty', () => {
    expect(routinePositionAt(base, [], 900)).toEqual(base);
  });
});
