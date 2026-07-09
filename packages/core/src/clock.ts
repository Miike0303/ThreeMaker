/**
 * Injectable clock abstraction for the game loop.
 *
 * `THREE.Clock` is deprecated (r183), and pulling three.js into `core` would
 * also break the "headless, testable in Node" constraint. This is a minimal
 * replacement good enough for a fixed/variable timestep loop, backed by
 * `performance.now()` in the default implementation and freely fakeable in
 * tests.
 */
export interface Clock {
  /** Current time in seconds, monotonic, arbitrary epoch. */
  now(): number;
}

/**
 * Default `Clock` implementation based on `performance.now()`.
 * Works in Node (via the global `performance` object) and in browsers.
 */
export class PerformanceClock implements Clock {
  now(): number {
    return performance.now() / 1000;
  }
}
