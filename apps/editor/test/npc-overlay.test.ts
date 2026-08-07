import type { NpcDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { computeNpcOverlayPoints } from '../src/npc-overlay.js';

const SPRITE = { object: 'a'.repeat(64), characterIndex: 0 };

function npc(overrides: Partial<NpcDocument> & Pick<NpcDocument, 'id'>): NpcDocument {
  return {
    x: 0,
    y: 0,
    floor: 'floor-0',
    facing: 'down',
    sprite: SPRITE,
    onInteract: 'talk',
    ...overrides,
  };
}

describe('computeNpcOverlayPoints', () => {
  it('returns every NPC on the given floor', () => {
    const npcs = [
      npc({ id: 'npc-1', x: 1, y: 2 }),
      npc({ id: 'npc-2', x: 3, y: 4, floor: 'floor-1' }),
      npc({ id: 'npc-3', x: 5, y: 6 }),
    ];
    expect(computeNpcOverlayPoints(npcs, 'floor-0')).toEqual([
      { id: 'npc-1', x: 1, y: 2 },
      { id: 'npc-3', x: 5, y: 6 },
    ]);
  });

  it('returns an empty list when no NPCs sit on the floor', () => {
    expect(computeNpcOverlayPoints([npc({ id: 'npc-1' })], 'floor-1')).toEqual([]);
  });
});
