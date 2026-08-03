/**
 * Pure walk-input helpers extracted from `main.ts` (PLAN_DEV_2 C2 prep:
 * extract what desktop already does before a shared `packages/input` layer).
 *
 * Free of DOM/`window` so vitest (`environment: 'node'`) can drive press/
 * release without a browser. The desktop host binds keydown/keyup to
 * {@link MostRecentHeldDirection.press}/{@link MostRecentHeldDirection.release}.
 */

import type { Direction } from '@threemaker/gameplay';

/** WASD/arrow keys → the grid direction they move the character in. */
const MOVE_KEYS: Readonly<Record<string, Direction>> = {
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
};

/**
 * Maps a raw `KeyboardEvent.key` (any casing) to a grid {@link Direction},
 * or `undefined` when the key is not a movement key.
 */
export function directionFromMoveKey(key: string): Direction | undefined {
  return MOVE_KEYS[key.toLowerCase()];
}

export type MostRecentHeldDirection = {
  /** Register a movement key press (or re-press: becomes most recent). */
  press(key: string): void;
  /** Drop a movement key that was released. No-op for non-move keys. */
  release(key: string): void;
  /** The most recently pressed movement direction still held, if any. */
  current(): Direction | undefined;
  /**
   * Clears every held direction. Movement keys double as dialogue
   * navigation — if the player holds an arrow into an NPC, the keydown that
   * opens dialogue never fires a matching keyup, so the arrow stays "held".
   * Call when a script ends so that stale entry does not auto-walk the next
   * idle frame; any key still physically held re-registers on its next
   * keydown/repeat.
   */
  clear(): void;
};

/**
 * Tracks currently-held movement keys in press order; the most recently
 * pressed one (still held) wins when several are held at once.
 */
export function createMostRecentHeldDirection(): MostRecentHeldDirection {
  const held: Direction[] = [];

  return {
    press(key) {
      const direction = directionFromMoveKey(key);
      if (!direction) return;
      const index = held.indexOf(direction);
      if (index !== -1) held.splice(index, 1);
      held.push(direction);
    },
    release(key) {
      const direction = directionFromMoveKey(key);
      if (!direction) return;
      const index = held.indexOf(direction);
      if (index !== -1) held.splice(index, 1);
    },
    current: () => held[held.length - 1],
    clear: () => {
      held.length = 0;
    },
  };
}
