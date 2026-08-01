import { describe, expect, it } from 'vitest';
import type { NpcDefinition } from '../src/npc-registry.js';
import { NpcRegistry } from '../src/npc-registry.js';
import type { TriggerDefinition } from '../src/trigger-index.js';
import { TriggerIndex } from '../src/trigger-index.js';

// `floor` is a runtime floor INDEX, while a `.tmmap` document carries a floor
// ID string. Both reach these classes at the same boundary, and TypeScript
// cannot help once a document value crosses it, so the casts below stand in
// for what a missed id-to-index conversion would really pass.
const npc = (floor: unknown): NpcDefinition =>
  ({
    id: 'elder',
    x: 1,
    y: 2,
    floor,
    facing: 'down',
    sprite: { sheet: 'sheet', index: 0 },
    onInteract: 'ev',
  }) as NpcDefinition;

const trigger = (floor: unknown): TriggerDefinition =>
  ({ id: 't', x: 1, y: 2, floor, on: 'enter', event: 'ev' }) as TriggerDefinition;

const BAD: readonly (readonly [string, unknown])[] = [
  ['NaN', Number.NaN],
  ['a negative floor', -1],
  ['a fractional floor', 1.5],
  ['a floor id string', '0'],
  ['a missing floor', undefined],
];

describe('floor index validation', () => {
  it.each(BAD)('NpcRegistry rejects %s at construction', (_label, bad) => {
    expect(() => new NpcRegistry([npc(bad)])).toThrow(/floor/i);
  });

  it.each(BAD)('TriggerIndex rejects %s at construction', (_label, bad) => {
    expect(() => new TriggerIndex([trigger(bad)])).toThrow(/floor/i);
  });

  it('names the offending value and the entity it came from', () => {
    expect(() => new NpcRegistry([npc('floor-0')])).toThrow(/elder/);
    expect(() => new NpcRegistry([npc('floor-0')])).toThrow(/floor-0/);
  });

  it('rejects an invalid initialTile floor', () => {
    expect(() => new TriggerIndex([], { x: 0, y: 0, floor: Number.NaN })).toThrow(/floor/i);
  });

  it('rejects an invalid floor in every lookup', () => {
    const registry = new NpcRegistry([npc(0)]);
    expect(() => registry.occupies(Number.NaN, 1, 2)).toThrow(/floor/i);
    expect(() => registry.findNpcAt('0' as unknown as number, 1, 2)).toThrow(/floor/i);
    expect(() => registry.npcAdjacentFacing(-1, 1, 2, 'down')).toThrow(/floor/i);

    const index = new TriggerIndex([trigger(0)]);
    expect(() => index.enter(-1, 1, 2)).toThrow(/floor/i);
    expect(() => index.interact(1.5, 1, 2, 'down')).toThrow(/floor/i);
  });
});
