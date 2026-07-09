import type { Clock } from './clock.js';
import { PerformanceClock } from './clock.js';

export interface GameLoopOptions {
  /** Clock used to measure elapsed time. Defaults to `PerformanceClock`. */
  clock?: Clock;
  /**
   * Fixed timestep in seconds. When set, `onTick` is invoked zero or more
   * times per `tick()` call, each with exactly `fixedStep` as `dt`, to
   * catch up with elapsed wall-clock time (classic fixed-timestep loop).
   * When omitted, the loop runs in variable-timestep mode: `onTick` is
   * invoked once per `tick()` call with the actual elapsed time.
   */
  fixedStep?: number;
  /**
   * Upper bound (seconds) on elapsed time considered per `tick()` call.
   * Prevents a "spiral of death" after a long stall (e.g. a debugger pause).
   * Defaults to 0.25s.
   */
  maxDelta?: number;
  /** Called with the delta time (seconds) for each simulation step. */
  onTick: (dt: number) => void;
}

/**
 * Drives a simulation step from an injectable `Clock`, decoupled from any
 * particular scheduler (`requestAnimationFrame`, `setInterval`, a test
 * harness, ...). The caller decides when to invoke `tick()`.
 */
export class GameLoop {
  private readonly clock: Clock;
  private readonly fixedStep: number | undefined;
  private readonly maxDelta: number;
  private readonly onTick: (dt: number) => void;

  private lastTime: number | null = null;
  private accumulator = 0;
  private _running = false;

  constructor(options: GameLoopOptions) {
    this.clock = options.clock ?? new PerformanceClock();
    this.fixedStep = options.fixedStep;
    this.maxDelta = options.maxDelta ?? 0.25;
    this.onTick = options.onTick;
  }

  get running(): boolean {
    return this._running;
  }

  /** Marks the loop as running and resets internal timing state. */
  start(): void {
    this._running = true;
    this.lastTime = this.clock.now();
    this.accumulator = 0;
  }

  /** Marks the loop as stopped. `tick()` becomes a no-op until `start()` again. */
  stop(): void {
    this._running = false;
    this.lastTime = null;
  }

  /**
   * Advances the simulation. Call this once per external frame/tick source.
   * Returns the number of `onTick` invocations performed (0 or 1 in
   * variable-timestep mode; 0..N in fixed-timestep mode).
   */
  tick(): number {
    if (!this._running) return 0;

    const now = this.clock.now();
    const previous = this.lastTime ?? now;
    let delta = now - previous;
    if (delta > this.maxDelta) delta = this.maxDelta;
    if (delta < 0) delta = 0;
    this.lastTime = now;

    if (this.fixedStep === undefined) {
      this.onTick(delta);
      return 1;
    }

    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= this.fixedStep) {
      this.onTick(this.fixedStep);
      this.accumulator -= this.fixedStep;
      steps++;
    }
    return steps;
  }
}
