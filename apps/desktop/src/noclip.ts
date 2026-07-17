/**
 * Ctrl noclip debug mode (rpgm-whole-game-import, user-requested): while
 * `isNoclipActive()` returns true, movement ignores passability entirely
 * (walk through walls/elevation constraints -- whatever `canMove` checks).
 * Releasing the key restores normal rules immediately, EXCEPT it never
 * permanently re-traps the player: if they're currently standing on a tile
 * that fails its own standability (walked there via noclip, or reached any
 * other way -- an already-bad authored spawn on disk, say), stepping to an
 * adjacent tile that IS standable is still allowed even with noclip off,
 * instead of leaving every direction blocked by the origin tile's own
 * flags forever.
 *
 * Wraps an existing `GridMoverOptions.canMove` check rather than
 * duplicating any flag/passability math -- `main.ts` passes the SAME
 * `floorRouter.passability`-backed closure it already builds, wrapped once
 * with this function.
 */
import type { Direction } from '@threemaker/gameplay';
import { DIRECTION_DELTA } from '@threemaker/gameplay';

export type CanMoveCheck = (x: number, y: number, direction: Direction) => boolean;

/** The one piece of `PassabilityGrid` this wrapper needs beyond the `canMove` check itself: whether a tile is standable at all, to detect (and safely escape) a trapped origin. */
export interface StandabilityCheck {
  isStandable(x: number, y: number): boolean;
}

/**
 * Wraps `canMove` with noclip semantics:
 * 1. `isNoclipActive()` true -> always allow, `canMove` is never even called.
 * 2. Otherwise, delegate to `canMove`. If it allows the step, done.
 * 3. If `canMove` refuses AND the mover's current tile `(x, y)` is itself
 *    not standable (trapped), allow the step anyway as long as the
 *    DESTINATION tile is standable -- this is the "don't re-trap on
 *    release" rule. A normally-blocked step from a perfectly fine standing
 *    tile (e.g. a real wall, a one-way ledge) is completely unaffected.
 */
export function withNoclip(
  isNoclipActive: () => boolean,
  grid: StandabilityCheck,
  canMove: CanMoveCheck,
): CanMoveCheck {
  return (x, y, direction) => {
    if (isNoclipActive()) return true;
    if (canMove(x, y, direction)) return true;
    if (grid.isStandable(x, y)) return false;
    const delta = DIRECTION_DELTA[direction];
    return grid.isStandable(x + delta.x, y + delta.y);
  };
}
