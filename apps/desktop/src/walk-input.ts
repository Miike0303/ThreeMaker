/**
 * Desktop walk-input seam: maps raw keys to grid {@link Direction} via the
 * shared `@threemaker/input` action layer (PLAN_DEV_2 C2 WU-01).
 *
 * Free of DOM/`window` so vitest (`environment: 'node'`) can drive press/
 * release without a browser. The desktop host binds keydown/keyup to
 * {@link MostRecentHeldDirection.press}/{@link MostRecentHeldDirection.release}.
 */

import type { Direction } from '@threemaker/gameplay';
import {
  createBindingTable,
  createMostRecentHeldAction,
  defaultKeyboardBindings,
  directionFromMoveAction,
  isMoveAction,
} from '@threemaker/input';

const defaultTable = createBindingTable(defaultKeyboardBindings());

function moveActionFromKey(key: string): string | undefined {
  const action = defaultTable.actionForKeyboardKey(key);
  return action !== undefined && isMoveAction(action) ? action : undefined;
}

/**
 * Maps a raw `KeyboardEvent.key` (any casing) to a grid {@link Direction},
 * or `undefined` when the key is not a movement key.
 */
export function directionFromMoveKey(key: string): Direction | undefined {
  return directionFromMoveAction(moveActionFromKey(key));
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
  const held = createMostRecentHeldAction(moveActionFromKey);

  return {
    press: (key) => held.press(key),
    release: (key) => held.release(key),
    current: () => directionFromMoveAction(held.current()),
    clear: () => held.clear(),
  };
}
