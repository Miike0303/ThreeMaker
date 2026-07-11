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
   * The NPC standing at `(x, y)`, or `undefined` if none does. Use
   * `npc.onInteract` to route an interact input to that NPC's event.
   */
  findNpcAt(x: number, y: number): NpcDefinition | undefined {
    return this.npcs.find((npc) => npc.x === x && npc.y === y);
  }
}
