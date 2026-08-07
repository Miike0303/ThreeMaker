/**
 * Pure simulated in-game clock. Advances simulated minutes from real-time
 * delta; no signals and no world-state coupling — the DESKTOP writes
 * `clock.minutes` into world-state once per crossed minute (WU-02).
 */

export const MINUTES_PER_DAY = 1440;

export interface WorldClockOptions {
  /** Simulated minutes advanced per real second; must be finite and > 0. */
  readonly minutesPerRealSecond: number;
  /**
   * Starting whole minute in [0, 1440). Defaults to 480 (08:00).
   */
  readonly startMinutes?: number;
}

export class WorldClock {
  private readonly minutesPerRealSecond: number;
  private wholeMinutes: number;
  /** Fractional minute accumulator; never discarded across `advance` calls. */
  private remainder = 0;

  constructor(options: WorldClockOptions) {
    const { minutesPerRealSecond, startMinutes = 480 } = options;
    if (!Number.isFinite(minutesPerRealSecond) || minutesPerRealSecond <= 0) {
      throw new Error(
        `WorldClock: minutesPerRealSecond must be finite and > 0, got ${String(minutesPerRealSecond)}.`,
      );
    }
    this.minutesPerRealSecond = minutesPerRealSecond;
    this.wholeMinutes = assertMinute(startMinutes, 'startMinutes');
  }

  /** Current whole minute of the day, integer in [0, 1440). */
  get minutes(): number {
    return this.wholeMinutes;
  }

  /**
   * Advance the clock by `dtSeconds` of real time. Accumulates fractional
   * simulated minutes internally and returns how many whole minute boundaries
   * were crossed (0..n). `minutes` wraps at {@link MINUTES_PER_DAY}.
   */
  advance(dtSeconds: number): number {
    this.remainder += dtSeconds * this.minutesPerRealSecond;
    const crossed = Math.floor(this.remainder);
    this.remainder -= crossed;
    this.wholeMinutes = (this.wholeMinutes + crossed) % MINUTES_PER_DAY;
    return crossed;
  }

  /**
   * Set the current whole minute (save rehydrate). Resets the fractional
   * remainder so prior partial minutes do not leak into the next `advance`.
   */
  setMinutes(value: number): void {
    this.wholeMinutes = assertMinute(value, 'setMinutes');
    this.remainder = 0;
  }
}

function assertMinute(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value >= MINUTES_PER_DAY) {
    throw new Error(
      `WorldClock: ${label} must be an integer in [0, ${MINUTES_PER_DAY}), got ${String(value)}.`,
    );
  }
  return value;
}
