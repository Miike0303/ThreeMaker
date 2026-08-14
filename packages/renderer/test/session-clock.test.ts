/**
 * C7 WU-02: pure session-clock helpers (format, save re-sync, multi-minute tick).
 */
import { WorldClock, WorldState } from '@threemaker/core';
import { describe, expect, it, vi } from 'vitest';
import {
  CLOCK_MINUTES_KEY,
  formatClockMinutes,
  resyncClockFromWorldValue,
  tickSessionClock,
} from '../src/runtime/session-clock.js';

describe('formatClockMinutes', () => {
  it('formats whole minutes as zero-padded HH:MM', () => {
    expect(formatClockMinutes(0)).toBe('00:00');
    expect(formatClockMinutes(480)).toBe('08:00');
    expect(formatClockMinutes(1439)).toBe('23:59');
  });
});

describe('resyncClockFromWorldValue', () => {
  it('applies setMinutes for a valid whole minute', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 480 });
    expect(resyncClockFromWorldValue(clock, 900)).toBe(true);
    expect(clock.minutes).toBe(900);
  });

  it('leaves the clock untouched when the value is absent or invalid', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 480 });

    expect(resyncClockFromWorldValue(clock, undefined)).toBe(false);
    expect(clock.minutes).toBe(480);

    expect(resyncClockFromWorldValue(clock, '900')).toBe(false);
    expect(clock.minutes).toBe(480);

    expect(resyncClockFromWorldValue(clock, 1.5)).toBe(false);
    expect(resyncClockFromWorldValue(clock, -1)).toBe(false);
    expect(resyncClockFromWorldValue(clock, 1440)).toBe(false);
    expect(clock.minutes).toBe(480);
  });
});

describe('tickSessionClock (multi-minute crossing)', () => {
  it('writes world once with the final minute when several minutes cross', () => {
    // 1 sim-minute per real second; start at 100; advance 3.5s → crosses 3.
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 100 });
    const world = new WorldState();
    world.set(CLOCK_MINUTES_KEY, clock.minutes);
    const setSpy = vi.spyOn(world, 'set');

    const crossed = tickSessionClock(clock, world, 3.5);

    expect(crossed).toBe(3);
    expect(clock.minutes).toBe(103);
    // One write with the final minute — not one per crossed boundary.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(CLOCK_MINUTES_KEY, 103);
    expect(world.get(CLOCK_MINUTES_KEY)).toBe(103);
  });

  it('writes nothing when no whole minute is crossed', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 100 });
    const world = new WorldState();
    world.set(CLOCK_MINUTES_KEY, clock.minutes);
    const setSpy = vi.spyOn(world, 'set');

    const crossed = tickSessionClock(clock, world, 0.4);

    expect(crossed).toBe(0);
    expect(clock.minutes).toBe(100);
    expect(setSpy).not.toHaveBeenCalled();
  });
});
