import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, WorldClock } from '../src/world-clock.js';

describe('WorldClock', () => {
  it('exposes MINUTES_PER_DAY = 1440', () => {
    expect(MINUTES_PER_DAY).toBe(1440);
  });

  it('defaults startMinutes to 480 (08:00)', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1 });
    expect(clock.minutes).toBe(480);
  });

  it('accepts an explicit startMinutes', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 0 });
    expect(clock.minutes).toBe(0);
  });

  it('returns 0 when advance stays sub-minute', () => {
    // 0.5 real seconds * 1 min/s = 0.5 simulated minutes → no whole boundary
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 100 });
    expect(clock.advance(0.5)).toBe(0);
    expect(clock.minutes).toBe(100);
  });

  it('returns n whole minutes crossed on a large dt', () => {
    // 3.0 s * 1 min/s = 3 whole minutes
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 100 });
    expect(clock.advance(3)).toBe(3);
    expect(clock.minutes).toBe(103);
  });

  it('carries fractional remainder across successive advances', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 0 });
    expect(clock.advance(0.6)).toBe(0);
    expect(clock.minutes).toBe(0);
    // 0.6 + 0.6 = 1.2 → crosses 1 boundary, remainder 0.2
    expect(clock.advance(0.6)).toBe(1);
    expect(clock.minutes).toBe(1);
    // 0.2 + 0.9 = 1.1 → crosses 1 more
    expect(clock.advance(0.9)).toBe(1);
    expect(clock.minutes).toBe(2);
  });

  it('wraps minutes at 1440', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 1438 });
    expect(clock.advance(5)).toBe(5);
    expect(clock.minutes).toBe(3); // 1438 + 5 = 1443 → 3
  });

  it('setMinutes sets whole minutes and resets the fractional remainder', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: 0 });
    clock.advance(0.75); // remainder 0.75, minutes still 0
    clock.setMinutes(600);
    expect(clock.minutes).toBe(600);
    // Prior fractional remainder must not leak into the next advance
    expect(clock.advance(0.5)).toBe(0);
    expect(clock.minutes).toBe(600);
    expect(clock.advance(0.6)).toBe(1);
    expect(clock.minutes).toBe(601);
  });

  it('rejects non-positive or non-finite minutesPerRealSecond', () => {
    expect(() => new WorldClock({ minutesPerRealSecond: 0 })).toThrow(/minutesPerRealSecond/);
    expect(() => new WorldClock({ minutesPerRealSecond: -1 })).toThrow(/minutesPerRealSecond/);
    expect(() => new WorldClock({ minutesPerRealSecond: Number.NaN })).toThrow(
      /minutesPerRealSecond/,
    );
    expect(() => new WorldClock({ minutesPerRealSecond: Number.POSITIVE_INFINITY })).toThrow(
      /minutesPerRealSecond/,
    );
  });

  it('rejects non-integer or out-of-range startMinutes', () => {
    expect(() => new WorldClock({ minutesPerRealSecond: 1, startMinutes: -1 })).toThrow(
      /startMinutes/,
    );
    expect(() => new WorldClock({ minutesPerRealSecond: 1, startMinutes: 1440 })).toThrow(
      /startMinutes/,
    );
    expect(() => new WorldClock({ minutesPerRealSecond: 1, startMinutes: 1.5 })).toThrow(
      /startMinutes/,
    );
  });

  it('rejects non-integer or out-of-range setMinutes', () => {
    const clock = new WorldClock({ minutesPerRealSecond: 1 });
    expect(() => clock.setMinutes(-1)).toThrow(/setMinutes|minutes/);
    expect(() => clock.setMinutes(1440)).toThrow(/setMinutes|minutes/);
    expect(() => clock.setMinutes(3.14)).toThrow(/setMinutes|minutes/);
  });
});
