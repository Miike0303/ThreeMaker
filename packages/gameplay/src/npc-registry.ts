import type { Direction } from './grid-mover.js';
import { DIRECTION_DELTA } from './grid-mover.js';
import type { NpcDefinition } from './parse-npcs.js';

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Indexes static NPC positions for collision and interact lookups.
 *
 * ponytail: NPCs are static in this slice -- no movement/schedules; the
 * registry only ever reflects each NPC's definition-time `(x, y)`, matching
 * the design's explicit v1 ceiling.
 */
export class NpcRegistry {
  private readonly npcs: readonly NpcDefinition[];
  private readonly occupiedTiles: ReadonlySet<string>;

  constructor(npcs: readonly NpcDefinition[]) {
    this.npcs = npcs;
    this.occupiedTiles = new Set(npcs.map((npc) => tileKey(npc.x, npc.y)));
  }

  /**
   * Whether an NPC occupies `(x, y)`. Compose at the callsite with
   * `PassabilityGrid#canMove` to block movement onto NPC tiles --
   * `PassabilityGrid` itself stays terrain-only:
   *
   * ```ts
   * const canMove = (x, y, direction) => {
   *   const delta = DIRECTION_DELTA[direction];
   *   return (
   *     passability.canMove(x, y, direction) &&
   *     !npcRegistry.occupies(x + delta.x, y + delta.y)
   *   );
   * };
   * ```
   */
  occupies(x: number, y: number): boolean {
    return this.occupiedTiles.has(tileKey(x, y));
  }

  /**
   * The NPC standing at the exact tile `(x, y)`, or `undefined` if none
   * does. A direct tile lookup -- to route a player's interact input
   * (which checks the tile one step *ahead* in their facing direction, not
   * their own tile), use `npcAdjacentFacing` instead.
   */
  findNpcAt(x: number, y: number): NpcDefinition | undefined {
    return this.npcs.find((npc) => npc.x === x && npc.y === y);
  }

  /**
   * The NPC the player at `(x, y)` facing `facing` would interact with --
   * the tile one step ahead in the facing direction (mirrors
   * `TriggerIndex#interact`'s encapsulated adjacency+facing math, so
   * callers never hand-roll `DIRECTION_DELTA` arithmetic for this check).
   * Returns `undefined` when no NPC stands there. Use `npc.onInteract` to
   * route the result to the NPC's event.
   *
   * ```ts
   * const target = npcRegistry.npcAdjacentFacing(player.tile.x, player.tile.y, player.facing);
   * if (target) interpreter.run(eventScript.events[target.onInteract]);
   * ```
   */
  npcAdjacentFacing(x: number, y: number, facing: Direction): NpcDefinition | undefined {
    const delta = DIRECTION_DELTA[facing];
    return this.findNpcAt(x + delta.x, y + delta.y);
  }
}
