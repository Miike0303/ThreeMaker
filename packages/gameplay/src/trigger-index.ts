import type { Direction, GridPosition } from './grid-mover.js';
import { DIRECTION_DELTA } from './grid-mover.js';
import type { TriggerDefinition } from './parse-triggers.js';

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Indexes tile triggers by coordinate and evaluates on-enter/on-interact
 * firing per spec #51 (map-triggers). Returns event ids only — the caller
 * (composition root) routes them to `EventInterpreter#run`; this package
 * has no interpreter coupling.
 *
 * ponytail: triggers have no conditions or once-only flags in this slice --
 * every matching trigger fires its event every time its condition is met.
 * Gating (e.g. "only ever fires once") is a future event-authoring
 * feature, not modeled here.
 */
export class TriggerIndex {
  private readonly byTile: ReadonlyMap<string, readonly TriggerDefinition[]>;
  // Last tile the player was reported at, for on-enter dedup. `enter()`
  // called again for the same tile (standing still, or repeated per-frame
  // calls mid-tile) is a no-op; a changed tile is a fresh arrival, even if
  // it's a tile visited before -- leaving then re-entering re-fires.
  private lastTileKey: string | null;

  constructor(triggers: readonly TriggerDefinition[], initialTile?: GridPosition) {
    const byTile = new Map<string, TriggerDefinition[]>();
    for (const trigger of triggers) {
      const key = tileKey(trigger.x, trigger.y);
      const existing = byTile.get(key);
      if (existing) existing.push(trigger);
      else byTile.set(key, [trigger]);
    }
    this.byTile = byTile;
    // When no starting tile is given, the first `enter()` call is treated
    // as an arrival (fires if it lands on a trigger tile). Pass the
    // player's spawn tile to avoid firing for a trigger the player merely
    // spawns on top of.
    this.lastTileKey = initialTile ? tileKey(initialTile.x, initialTile.y) : null;
  }

  /**
   * Reports the player's current tile. Returns the event ids of every
   * `on: 'enter'` trigger on that tile, but only the first time this tile
   * is reported after being on a different one -- safe to call every
   * frame, or only on completed moves.
   */
  enter(x: number, y: number): readonly string[] {
    const key = tileKey(x, y);
    if (key === this.lastTileKey) return [];
    this.lastTileKey = key;
    return this.triggersAt(x, y, 'enter');
  }

  /**
   * Reports an interact input while the player stands at `(x, y)` facing
   * `facing`. Returns the event ids of every `on: 'interact'` trigger on
   * the tile directly ahead (one step in the facing direction) -- this
   * naturally requires both adjacency and facing, since the checked tile
   * is derived from exactly one `DIRECTION_DELTA` step.
   */
  interact(x: number, y: number, facing: Direction): readonly string[] {
    const delta = DIRECTION_DELTA[facing];
    return this.triggersAt(x + delta.x, y + delta.y, 'interact');
  }

  private triggersAt(x: number, y: number, on: TriggerDefinition['on']): readonly string[] {
    const triggers = this.byTile.get(tileKey(x, y)) ?? [];
    return triggers.filter((trigger) => trigger.on === on).map((trigger) => trigger.event);
  }
}
