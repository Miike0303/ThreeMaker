import { describe, expect, it } from 'vitest';
import type { Direction } from '../src/grid-mover.js';
import { DIRECTION_DELTA } from '../src/grid-mover.js';
import { NpcRegistry } from '../src/npc-registry.js';
import type { NpcDefinition } from '../src/parse-npcs.js';

function npc(overrides: Partial<NpcDefinition> = {}): NpcDefinition {
  return {
    id: 'elder',
    x: 3,
    y: 4,
    facing: 'down',
    sprite: { sheet: 'Actor1', index: 1 },
    onInteract: 'elder-intro',
    ...overrides,
  };
}

describe('NpcRegistry', () => {
  it('reports occupies(x, y) true only for tiles an NPC stands on', () => {
    const registry = new NpcRegistry([npc({ x: 3, y: 4 })]);

    expect(registry.occupies(3, 4)).toBe(true);
    expect(registry.occupies(3, 5)).toBe(false);
  });

  it('finds the NPC standing at a given tile', () => {
    const registry = new NpcRegistry([npc({ id: 'elder', x: 3, y: 4, onInteract: 'elder-intro' })]);

    expect(registry.findNpcAt(3, 4)?.onInteract).toBe('elder-intro');
    expect(registry.findNpcAt(0, 0)).toBeUndefined();
  });

  it('reports occupies() true for every NPC when several share different tiles', () => {
    const registry = new NpcRegistry([npc({ id: 'a', x: 1, y: 1 }), npc({ id: 'b', x: 2, y: 2 })]);

    expect(registry.occupies(1, 1)).toBe(true);
    expect(registry.occupies(2, 2)).toBe(true);
    expect(registry.occupies(3, 3)).toBe(false);
  });

  it('composes with PassabilityGrid#canMove to block NPC tiles while allowing others', () => {
    const passability = {
      // Fully open floor: stands in for a real PassabilityGrid instance.
      canMove: (_x: number, _y: number, _direction: Direction) => true,
    };
    const registry = new NpcRegistry([npc({ x: 5, y: 5 })]);

    const canMove = (x: number, y: number, direction: Direction): boolean => {
      const delta = DIRECTION_DELTA[direction];
      const destX = x + delta.x;
      const destY = y + delta.y;
      return passability.canMove(x, y, direction) && !registry.occupies(destX, destY);
    };

    expect(canMove(4, 5, 'right')).toBe(false); // (5,5) is the NPC tile
    expect(canMove(5, 6, 'up')).toBe(false); // (5,5) is the NPC tile, approached from below
    expect(canMove(5, 6, 'down')).toBe(true); // (5,7) is open
  });

  it('treats occupies() as reflecting NPC positions only, independent of the player', () => {
    // Edge case: an NPC definition happens to share a tile with the
    // player's current position (e.g. bad content data). occupies() must
    // still report true for that tile — it has no notion of "player" at
    // all, only NPC tiles.
    const playerTile = { x: 3, y: 4 };
    const registry = new NpcRegistry([npc({ x: playerTile.x, y: playerTile.y })]);

    expect(registry.occupies(playerTile.x, playerTile.y)).toBe(true);
  });
});
