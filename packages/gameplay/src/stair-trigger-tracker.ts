import type { StairTraversalWaypoint } from './stair-traversal.js';

/** A stair-link's entry/landing pair, as needed for trigger dedup -- deliberately narrower than `@threemaker/desktop`'s own `StairLinkRuntime` (no `id`/`fromFloor`/`toFloor`), so this package stays map-format-agnostic (mirrors `StairTraversalWaypoint`'s own doc comment: resolving a document's shape to this is the caller's job). */
export interface StairLinkDefinition {
  /** Entry-to-landing path, in traversal order (see `StairTraversalOptions.waypoints`). */
  readonly waypoints: readonly StairTraversalWaypoint[];
  readonly bidirectional: boolean;
}

/** A tile on a specific floor, addressed by numeric floor index (matches `StairTraversalWaypoint.floor`). */
export interface StairTriggerTile {
  readonly floor: number;
  readonly x: number;
  readonly y: number;
}

function tileKey(tile: StairTriggerTile): string {
  return `${tile.floor}:${tile.x}:${tile.y}`;
}

/**
 * Tracks on-arrival dedup for stair-link triggers, extracted from
 * `apps/desktop/src/main.ts`'s formerly-inline `lastStairCheckKey` closure
 * (Slice 5 gate-fix: RELIABILITY -- makes the dedup unit-testable). Mirrors
 * `TriggerIndex#enter`'s own dedup pattern: reporting the same tile again
 * (standing still, or a chained multi-tile move re-reporting mid-chain) is a
 * no-op, but a genuinely NEW tile always re-evaluates, even one visited
 * before -- leaving then re-entering re-fires.
 *
 * `shouldTrigger` additionally scans `links` for a match: the AUTHORED
 * waypoint order when `tile` matches a link's entry (`waypoints[0]`), or the
 * REVERSED order when it matches a `bidirectional` link's landing
 * (`waypoints[waypoints.length - 1]`) -- same convention as
 * `MapSession.stairTriggerAt`'s own doc comment.
 *
 * `mark` records an arrival WITHOUT scanning `links` or returning a result --
 * for the one caller (a traversal's own completion-frame teleport onto a
 * bidirectional link's landing waypoint) that must prevent that SAME arrival
 * from instantly re-triggering the reverse trip, but has no use for a match
 * result it would only discard.
 */
export class StairTriggerTracker {
  private lastKey: string | null;

  /**
   * `initialTile`, when given, seeds the dedup key so the very first
   * `shouldTrigger` call for that SAME tile is a no-op -- matches
   * `TriggerIndex`'s own `initialTile` constructor param: spawning on top of
   * a stair-link waypoint (unlikely, but possible on a hand-authored map)
   * should not immediately fire a traversal.
   */
  constructor(initialTile?: StairTriggerTile) {
    this.lastKey = initialTile ? tileKey(initialTile) : null;
  }

  /** Records `tile` as already-checked, without evaluating `links` or returning a match. */
  mark(tile: StairTriggerTile): void {
    this.lastKey = tileKey(tile);
  }

  /**
   * Reports the current `tile` and returns the matching stair-link's
   * waypoints (forward or reversed, see class doc), or `undefined` when
   * `tile` was already reported last call (dedup) or matches no link.
   */
  shouldTrigger(
    tile: StairTriggerTile,
    links: readonly StairLinkDefinition[],
  ): readonly StairTraversalWaypoint[] | undefined {
    const key = tileKey(tile);
    if (key === this.lastKey) return undefined;
    this.lastKey = key;

    for (const link of links) {
      const entry = link.waypoints[0];
      if (entry && entry.floor === tile.floor && entry.x === tile.x && entry.y === tile.y) {
        return link.waypoints;
      }
      const landing = link.waypoints[link.waypoints.length - 1];
      if (
        link.bidirectional &&
        landing &&
        landing.floor === tile.floor &&
        landing.x === tile.x &&
        landing.y === tile.y
      ) {
        return [...link.waypoints].reverse();
      }
    }
    return undefined;
  }
}
