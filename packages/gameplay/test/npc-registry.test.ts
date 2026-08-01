import { describe, expect, it } from 'vitest';
import type { Direction } from '../src/grid-mover.js';
import { DIRECTION_DELTA } from '../src/grid-mover.js';
import type { NpcDefinition } from '../src/npc-registry.js';
import { NpcRegistry } from '../src/npc-registry.js';

function npc(overrides: Partial<NpcDefinition> = {}): NpcDefinition {
  return {
    id: 'elder',
    x: 3,
    y: 4,
    floor: 0,
    facing: 'down',
    sprite: { sheet: 'Actor1', index: 1 },
    onInteract: 'elder-intro',
    ...overrides,
  };
}

describe('NpcRegistry', () => {
  it('reports occupies(floor, x, y) true only for tiles an NPC stands on', () => {
    const registry = new NpcRegistry([npc({ x: 3, y: 4 })]);

    expect(registry.occupies(0, 3, 4)).toBe(true);
    expect(registry.occupies(0, 3, 5)).toBe(false);
  });

  it('finds the NPC standing at a given tile', () => {
    const registry = new NpcRegistry([npc({ id: 'elder', x: 3, y: 4, onInteract: 'elder-intro' })]);

    expect(registry.findNpcAt(0, 3, 4)?.onInteract).toBe('elder-intro');
    expect(registry.findNpcAt(0, 0, 0)).toBeUndefined();
  });

  it('reports occupies() true for every NPC when several share different tiles', () => {
    const registry = new NpcRegistry([npc({ id: 'a', x: 1, y: 1 }), npc({ id: 'b', x: 2, y: 2 })]);

    expect(registry.occupies(0, 1, 1)).toBe(true);
    expect(registry.occupies(0, 2, 2)).toBe(true);
    expect(registry.occupies(0, 3, 3)).toBe(false);
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
      return passability.canMove(x, y, direction) && !registry.occupies(0, destX, destY);
    };

    expect(canMove(4, 5, 'right')).toBe(false); // (5,5) is the NPC tile
    expect(canMove(5, 6, 'up')).toBe(false); // (5,5) is the NPC tile, approached from below
    expect(canMove(5, 6, 'down')).toBe(true); // (5,7) is open
  });
});

describe('NpcRegistry — floor scoping', () => {
  it('reports occupies() false for an NPC on a different floor at the same tile', () => {
    const registry = new NpcRegistry([npc({ id: 'upstairs', floor: 1, x: 3, y: 4 })]);

    expect(registry.occupies(1, 3, 4)).toBe(true);
    expect(registry.occupies(0, 3, 4)).toBe(false);
  });

  it('findNpcAt resolves the NPC of the queried floor when two share a tile', () => {
    const registry = new NpcRegistry([
      npc({ id: 'ground', floor: 0, x: 3, y: 4 }),
      npc({ id: 'upstairs', floor: 1, x: 3, y: 4 }),
    ]);

    expect(registry.findNpcAt(0, 3, 4)?.id).toBe('ground');
    expect(registry.findNpcAt(1, 3, 4)?.id).toBe('upstairs');
    expect(registry.findNpcAt(2, 3, 4)).toBeUndefined();
  });

  it('npcAdjacentFacing never reaches an NPC standing on another floor', () => {
    const registry = new NpcRegistry([npc({ id: 'upstairs', floor: 1, x: 3, y: 3 })]);

    expect(registry.npcAdjacentFacing(1, 3, 4, 'up')?.id).toBe('upstairs');
    expect(registry.npcAdjacentFacing(0, 3, 4, 'up')).toBeUndefined();
  });
});

describe('NpcRegistry.npcAdjacentFacing', () => {
  it('returns the NPC one tile ahead in each facing direction', () => {
    const registry = new NpcRegistry([npc({ id: 'elder', x: 3, y: 3 })]);

    expect(registry.npcAdjacentFacing(0, 3, 4, 'up')?.id).toBe('elder'); // player below, facing up
    expect(registry.npcAdjacentFacing(0, 3, 2, 'down')?.id).toBe('elder'); // player above, facing down
    expect(registry.npcAdjacentFacing(0, 4, 3, 'left')?.id).toBe('elder'); // player right, facing left
    expect(registry.npcAdjacentFacing(0, 2, 3, 'right')?.id).toBe('elder'); // player left, facing right
  });

  it('returns undefined when adjacent but facing the wrong direction', () => {
    const registry = new NpcRegistry([npc({ id: 'elder', x: 3, y: 3 })]);

    expect(registry.npcAdjacentFacing(0, 3, 4, 'down')).toBeUndefined();
  });

  it('returns undefined when facing the right direction but not adjacent', () => {
    const registry = new NpcRegistry([npc({ id: 'elder', x: 3, y: 3 })]);

    expect(registry.npcAdjacentFacing(0, 3, 5, 'up')).toBeUndefined();
  });
});
