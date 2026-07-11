/** RPG-Maker-style facing directions, matching the tile-passability directional bits. */
export type Direction = 'down' | 'left' | 'right' | 'up';

/** An integer tile coordinate. */
export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

/** A (possibly fractional) world-space tile coordinate, for rendering mid-step. */
export interface GridRenderPosition {
  readonly x: number;
  readonly y: number;
}

/** Tile-coordinate delta of a single step in each direction (y grows downward/south). */
export const DIRECTION_DELTA: Record<Direction, GridPosition> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface GridMoverOptions {
  /** Starting tile column/row. */
  readonly x: number;
  readonly y: number;
  /** Starting facing direction. Defaults to `'down'`. */
  readonly facing?: Direction;
  /** Movement speed in tiles/second. Defaults to 4. */
  readonly speed?: number;
  /**
   * Passability check: can the mover leave its current tile toward
   * `direction`? Defaults to always-passable (no collision) when omitted --
   * pass `PassabilityGrid#canMove` (bound to the grid instance) to enforce
   * real map collision.
   */
  readonly canMove?: (x: number, y: number, direction: Direction) => boolean;
}

const DEFAULT_SPEED = 4;
// Tolerance for the "step finished" comparison below. Holding a direction
// across many small dt frames (e.g. 60fps) sums floating-point increments
// into `stepProgress`; without this slack, accumulated rounding error can
// leave a step at progress ~0.999999999999998 forever "not quite" done,
// which reads as drift (a step that never completes). Real per-frame dt
// values are always many orders of magnitude larger than this.
const STEP_COMPLETE_EPSILON = 1e-9;
// ponytail: bounds the tile-chaining loop inside a single update() call. In
// practice GameLoop's own maxDelta (0.25s default) already prevents a huge
// dt from reaching here; this is just a second line of defense so a
// pathological dt can't spin update() forever.
const MAX_STEPS_PER_UPDATE = 64;

/**
 * Tile-to-tile grid movement with smooth interpolation, RPG-Maker style.
 *
 * Driven by `requestMove(direction)` + `update(dt)`, called once per frame:
 * call `requestMove` every frame a direction is held, and skip it the
 * frames it isn't (releasing the key). Behavior:
 *
 * - Idle + a new direction requested, not yet facing it: turns to face it,
 *   does not move (matches RPG Maker's "first press turns, doesn't step").
 * - Idle + already facing the requested direction: starts moving into the
 *   next tile (blocked by `canMove` if that tile can't be entered).
 * - Moving: keeps interpolating `progress` (0..1) toward the destination
 *   tile; on completion, if the same direction is still being requested,
 *   immediately chains into the next tile using any leftover time from this
 *   `update()` call, so holding a direction never drifts out of sync with
 *   `speed`.
 */
export class GridMover {
  private tileX: number;
  private tileY: number;
  private destX: number;
  private destY: number;
  private currentFacing: Direction;
  private isMoving = false;
  private stepProgress = 0;
  private readonly speed: number;
  private readonly canMoveCheck: (x: number, y: number, direction: Direction) => boolean;
  private pendingDirection: Direction | null = null;

  constructor(options: GridMoverOptions) {
    this.tileX = options.x;
    this.tileY = options.y;
    this.destX = options.x;
    this.destY = options.y;
    this.currentFacing = options.facing ?? 'down';
    this.speed = options.speed ?? DEFAULT_SPEED;
    this.canMoveCheck = options.canMove ?? (() => true);
  }

  /** Current (integer) tile; only changes when a step completes. */
  get tile(): GridPosition {
    return { x: this.tileX, y: this.tileY };
  }

  get facing(): Direction {
    return this.currentFacing;
  }

  get moving(): boolean {
    return this.isMoving;
  }

  /** 0 when idle; 0..1 progress of the active step while moving. */
  get progress(): number {
    return this.stepProgress;
  }

  /** Interpolated world position: the current tile while idle, or a point between source and destination while moving. */
  get renderPosition(): GridRenderPosition {
    if (!this.isMoving) return { x: this.tileX, y: this.tileY };
    return {
      x: this.tileX + (this.destX - this.tileX) * this.stepProgress,
      y: this.tileY + (this.destY - this.tileY) * this.stepProgress,
    };
  }

  /** Requests movement toward `direction` for the next `update()` call. Call every frame the input is held; omit it to let the mover come to rest. */
  requestMove(direction: Direction): void {
    this.pendingDirection = direction;
  }

  /**
   * Places the mover directly at `(x, y)`, bypassing `canMove` and any
   * step interpolation -- cancels an in-progress step, if any. Optionally
   * sets `facing`; omitting it preserves whatever the mover was already
   * facing. For an `EventCommand`'s `teleport` command (see
   * `@threemaker/core`'s `EventHost#teleport`), not everyday movement.
   */
  teleport(x: number, y: number, facing?: Direction): void {
    this.tileX = x;
    this.tileY = y;
    this.destX = x;
    this.destY = y;
    this.isMoving = false;
    this.stepProgress = 0;
    this.pendingDirection = null;
    if (facing !== undefined) this.currentFacing = facing;
  }

  /** Advances the simulation by `dt` seconds. */
  update(dt: number): void {
    const direction = this.pendingDirection;
    this.pendingDirection = null;

    let remaining = dt;
    let iterations = 0;
    while (remaining > 0 && iterations < MAX_STEPS_PER_UPDATE) {
      iterations++;

      if (this.isMoving) {
        const timeToFinish = (1 - this.stepProgress) / this.speed;
        if (timeToFinish > remaining + STEP_COMPLETE_EPSILON) {
          this.stepProgress += this.speed * remaining;
          remaining = 0;
        } else {
          remaining -= timeToFinish;
          this.tileX = this.destX;
          this.tileY = this.destY;
          this.isMoving = false;
          this.stepProgress = 0;
          // Loop again: if `direction` is still held, the next iteration
          // (now idle) immediately chains into the next tile using the
          // leftover `remaining` time.
        }
        continue;
      }

      if (!direction) break;

      if (direction !== this.currentFacing) {
        // Turning is instantaneous and does not consume simulated time or
        // chain into a move within the same update() call.
        this.currentFacing = direction;
        break;
      }

      if (!this.startStep(direction)) break; // blocked: stays idle, already facing direction
    }
  }

  private startStep(direction: Direction): boolean {
    if (!this.canMoveCheck(this.tileX, this.tileY, direction)) return false;
    const delta = DIRECTION_DELTA[direction];
    this.destX = this.tileX + delta.x;
    this.destY = this.tileY + delta.y;
    this.isMoving = true;
    this.stepProgress = 0;
    return true;
  }
}
