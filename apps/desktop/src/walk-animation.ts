/** Column index (0-2) into a character sheet's 3 walk-frame columns. */
export type WalkFrameColumn = 0 | 1 | 2;

// Classic RPG Maker walk cycle: standing, left-step, standing, right-step,
// repeat. Column 1 is the sheet's middle ("standing") frame.
const WALK_PATTERN: readonly WalkFrameColumn[] = [1, 0, 1, 2];
const STANDING_FRAME: WalkFrameColumn = 1;

export interface WalkAnimationOptions {
  /** Seconds spent on each pattern step. Defaults to 0.15s (~6.7 steps/second). */
  readonly frameDuration?: number;
}

/**
 * Pure walk-cycle timing: advances an internal clock while the character is
 * moving and reports which of the sheet's 3 frame columns to display. No
 * three.js/DOM -- the caller (character-sprite.ts) maps the returned column
 * plus a facing direction into a UV rect.
 */
export class WalkAnimation {
  private readonly frameDuration: number;
  private elapsed = 0;

  constructor(options: WalkAnimationOptions = {}) {
    this.frameDuration = options.frameDuration ?? 0.15;
    if (this.frameDuration <= 0) {
      throw new Error(`frameDuration must be positive, got ${this.frameDuration}.`);
    }
  }

  /** Advances the animation clock by `dt` seconds. Call every frame the character is moving. */
  update(dt: number): void {
    this.elapsed += dt;
  }

  /** Restarts the walk cycle from its first pattern step. Call whenever movement stops, so the next step always starts clean. */
  reset(): void {
    this.elapsed = 0;
  }

  /** The frame column to display: the standing frame while idle, or the current step of the walk pattern while `moving`. */
  frameColumn(moving: boolean): WalkFrameColumn {
    if (!moving) return STANDING_FRAME;
    const stepIndex = Math.floor(this.elapsed / this.frameDuration) % WALK_PATTERN.length;
    return WALK_PATTERN[stepIndex] ?? STANDING_FRAME;
  }
}
