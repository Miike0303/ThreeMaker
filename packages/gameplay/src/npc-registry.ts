import { assertFloorIndex } from './floor-index.js';
import type { Direction } from './grid-mover.js';
import { DIRECTION_DELTA } from './grid-mover.js';

/** Sprite-sheet reference for an NPC, matching `CharacterSprite`'s sheet/index addressing. */
export interface NpcSprite {
  readonly sheet: string;
  readonly index: number;
}

/**
 * One static NPC this registry indexes. The authoring source is a `.tmmap`
 * v4 `npcs[]` entry; the composition root translates it (document floor ID ->
 * runtime floor index, content-addressed sheet ref -> resolved sheet) before
 * handing it here.
 */
export interface NpcDefinition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /**
   * Runtime floor INDEX this NPC stands on (an index into the session's
   * `floors` array, like `StairLinkRuntime.fromFloor`) -- NOT a `.tmmap`
   * floor id. Every lookup below scopes by it, so two NPCs may share one
   * `(x, y)` on different floors. Asserted by `assertFloorIndex` at
   * construction, so a document floor id that leaked through translation
   * fails loudly here rather than silently missing every lookup.
   */
  readonly floor: number;
  readonly facing: Direction;
  readonly sprite: NpcSprite;
  /** Event id run when a player interacts with this NPC (see `NpcRegistry#findNpcAt`). */
  readonly onInteract: string;
}

// Floor-scoped: an NPC on floor 1 must never occupy or answer for the same
// `(x, y)` on floor 0 (stacked floors share one coordinate space). Every
// lookup below therefore takes the floor index FIRST, matching the desktop
// session's own `(floorIndex, x, y)` convention (`markStairArrival`,
// `stairTriggerAt`, `roomIdAt`).
function tileKey(floor: number, x: number, y: number): string {
  return `${floor}:${x},${y}`;
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
    for (const npc of npcs) assertFloorIndex(npc.floor, `NpcRegistry: npc "${npc.id}"`);
    this.npcs = npcs;
    this.occupiedTiles = new Set(npcs.map((npc) => tileKey(npc.floor, npc.x, npc.y)));
  }

  /**
   * Whether an NPC occupies `(x, y)` on floor `floor`. Compose at the
   * callsite with `PassabilityGrid#canMove` to block movement onto NPC
   * tiles -- `PassabilityGrid` itself stays terrain-only:
   *
   * ```ts
   * const canMove = (x, y, direction) => {
   *   const delta = DIRECTION_DELTA[direction];
   *   return (
   *     passability.canMove(x, y, direction) &&
   *     !npcRegistry.occupies(floorRouter.currentFloor, x + delta.x, y + delta.y)
   *   );
   * };
   * ```
   */
  occupies(floor: number, x: number, y: number): boolean {
    assertFloorIndex(floor, 'NpcRegistry#occupies');
    return this.occupiedTiles.has(tileKey(floor, x, y));
  }

  /**
   * The NPC standing at the exact tile `(x, y)` of floor `floor`, or
   * `undefined` if none does. A direct tile lookup -- to route a player's
   * interact input (which checks the tile one step *ahead* in their facing
   * direction, not their own tile), use `npcAdjacentFacing` instead.
   */
  findNpcAt(floor: number, x: number, y: number): NpcDefinition | undefined {
    assertFloorIndex(floor, 'NpcRegistry#findNpcAt');
    return this.npcs.find((npc) => npc.floor === floor && npc.x === x && npc.y === y);
  }

  /**
   * The NPC the player at `(x, y)` on floor `floor` facing `facing` would
   * interact with -- the tile one step ahead in the facing direction
   * (mirrors `TriggerIndex#interact`'s encapsulated adjacency+facing math,
   * so callers never hand-roll `DIRECTION_DELTA` arithmetic for this
   * check). The faced tile is always on the player's OWN floor, so an NPC
   * one step ahead on another floor is never reachable. Returns `undefined`
   * when no NPC stands there. Use `npc.onInteract` to route the result to
   * the NPC's event.
   *
   * ```ts
   * const target = npcRegistry.npcAdjacentFacing(floor, player.tile.x, player.tile.y, player.facing);
   * if (target) interpreter.run(eventScript.events[target.onInteract]);
   * ```
   */
  npcAdjacentFacing(
    floor: number,
    x: number,
    y: number,
    facing: Direction,
  ): NpcDefinition | undefined {
    const delta = DIRECTION_DELTA[facing];
    return this.findNpcAt(floor, x + delta.x, y + delta.y);
  }
}
