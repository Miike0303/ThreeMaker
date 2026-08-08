import { describe, expect, it } from 'vitest';
import { createBlankMapDocument } from '../src/map-compose.js';
import { applyDungeonStampToMapDocument } from '../src/procgen/apply-stamp.js';
import { stampSimpleDungeon } from '../src/procgen/dungeon-stamp.js';

describe('applyDungeonStampToMapDocument', () => {
  it('writes stamp layers onto floor 0 without changing map size', () => {
    const doc = createBlankMapDocument({
      id: 'stamp-apply',
      name: 'Stamp',
      width: 20,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const stamp = stampSimpleDungeon({
      width: 20,
      height: 16,
      seed: 99,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp);
    expect(next.width).toBe(20);
    expect(next.height).toBe(16);
    expect(next.floors[0]?.layers.tiles[0]).toEqual(stamp.layers[0]);
    expect(next.floors[0]?.layers.tiles[2]).toEqual(stamp.layers[2]);
  });

  it('preserves events, npcs, spawn, and worldSeeds on the document', () => {
    const base = createBlankMapDocument({
      id: 'stamp-keep',
      name: 'Keep',
      width: 16,
      height: 16,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const doc = {
      ...base,
      spawn: { x: 2, y: 2, floor: 'floor-0' },
      events: {
        talk: [{ type: 'showDialogue' as const, source: { kind: 'text' as const, lines: ['hi'] } }],
      },
      worldSeeds: { flag: true },
      npcs: [
        {
          id: 'npc-1',
          x: 3,
          y: 3,
          floor: 'floor-0',
          facing: 'down' as const,
          sprite: { object: 'c'.repeat(64), characterIndex: 0 },
          onInteract: 'talk',
        },
      ],
    };
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 1,
      groundTileId: 2816,
      wallTileId: 4352,
    });
    const next = applyDungeonStampToMapDocument(doc, stamp);
    expect(next.events).toEqual(doc.events);
    expect(next.npcs).toEqual(doc.npcs);
    expect(next.spawn).toEqual(doc.spawn);
    expect(next.worldSeeds).toEqual(doc.worldSeeds);
  });
});
