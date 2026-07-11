import { describe, expect, it } from 'vitest';
import { parseNpcs } from '../src/parse-npcs.js';

describe('parseNpcs', () => {
  it('parses a valid npcs file', () => {
    const result = parseNpcs({
      version: 1,
      npcs: [
        {
          id: 'elder',
          x: 3,
          y: 4,
          facing: 'down',
          sprite: { sheet: 'Actor1', index: 1 },
          onInteract: 'elder-intro',
        },
      ],
    });

    expect(result).toEqual({
      version: 1,
      npcs: [
        {
          id: 'elder',
          x: 3,
          y: 4,
          facing: 'down',
          sprite: { sheet: 'Actor1', index: 1 },
          onInteract: 'elder-intro',
        },
      ],
    });
  });

  it('parses an empty npcs array', () => {
    expect(parseNpcs({ version: 1, npcs: [] })).toEqual({ version: 1, npcs: [] });
  });

  it('throws when the root is not an object', () => {
    expect(() => parseNpcs('not-an-object')).toThrow(
      'Invalid NPC JSON: expected an object, got string.',
    );
  });

  it('throws when "version" is not 1', () => {
    expect(() => parseNpcs({ version: 2, npcs: [] })).toThrow(
      'Invalid NPC JSON: "version" must be 1, got 2.',
    );
  });

  it('throws when "npcs" is not an array', () => {
    expect(() => parseNpcs({ version: 1, npcs: {} })).toThrow(
      'Invalid NPC JSON: "npcs" must be an array.',
    );
  });

  it('throws when an npc is missing "id"', () => {
    expect(() =>
      parseNpcs({
        version: 1,
        npcs: [
          {
            x: 3,
            y: 4,
            facing: 'down',
            sprite: { sheet: 'Actor1', index: 1 },
            onInteract: 'e',
          },
        ],
      }),
    ).toThrow('Invalid NPC JSON: npcs[0] requires a string "id".');
  });

  it('throws when an npc is missing "onInteract"', () => {
    expect(() =>
      parseNpcs({
        version: 1,
        npcs: [{ id: 'elder', x: 3, y: 4, facing: 'down', sprite: { sheet: 'Actor1', index: 1 } }],
      }),
    ).toThrow('Invalid NPC JSON: npcs[0] requires a string "onInteract".');
  });

  it('throws on an invalid "facing" value', () => {
    expect(() =>
      parseNpcs({
        version: 1,
        npcs: [
          {
            id: 'elder',
            x: 3,
            y: 4,
            facing: 'north',
            sprite: { sheet: 'Actor1', index: 1 },
            onInteract: 'e',
          },
        ],
      }),
    ).toThrow(
      'Invalid NPC JSON: npcs[0] "facing" must be one of down, left, right, up, got "north".',
    );
  });

  it('throws on non-integer "x"', () => {
    expect(() =>
      parseNpcs({
        version: 1,
        npcs: [
          {
            id: 'elder',
            x: 3.5,
            y: 4,
            facing: 'down',
            sprite: { sheet: 'Actor1', index: 1 },
            onInteract: 'e',
          },
        ],
      }),
    ).toThrow('Invalid NPC JSON: npcs[0] "x" must be an integer, got 3.5.');
  });

  it('throws on non-integer "y"', () => {
    expect(() =>
      parseNpcs({
        version: 1,
        npcs: [
          {
            id: 'elder',
            x: 3,
            y: 'four',
            facing: 'down',
            sprite: { sheet: 'Actor1', index: 1 },
            onInteract: 'e',
          },
        ],
      }),
    ).toThrow('Invalid NPC JSON: npcs[0] "y" must be an integer, got "four".');
  });

  it('throws when "sprite" is missing', () => {
    expect(() =>
      parseNpcs({
        version: 1,
        npcs: [{ id: 'elder', x: 3, y: 4, facing: 'down', onInteract: 'e' }],
      }),
    ).toThrow('Invalid NPC JSON: npcs[0] requires a "sprite" object.');
  });

  it('throws when "sprite.sheet" is not a string', () => {
    expect(() =>
      parseNpcs({
        version: 1,
        npcs: [
          {
            id: 'elder',
            x: 3,
            y: 4,
            facing: 'down',
            sprite: { sheet: 1, index: 1 },
            onInteract: 'e',
          },
        ],
      }),
    ).toThrow('Invalid NPC JSON: npcs[0] "sprite.sheet" must be a string.');
  });

  it('throws when "sprite.index" is not an integer', () => {
    expect(() =>
      parseNpcs({
        version: 1,
        npcs: [
          {
            id: 'elder',
            x: 3,
            y: 4,
            facing: 'down',
            sprite: { sheet: 'Actor1', index: 1.5 },
            onInteract: 'e',
          },
        ],
      }),
    ).toThrow('Invalid NPC JSON: npcs[0] "sprite.index" must be an integer, got 1.5.');
  });

  it('throws when two npcs occupy the same tile', () => {
    const npcAt = (id: string, x: number, y: number) => ({
      id,
      x,
      y,
      facing: 'down',
      sprite: { sheet: 'Actor1', index: 1 },
      onInteract: 'e',
    });

    expect(() =>
      parseNpcs({
        version: 1,
        npcs: [
          npcAt('villager', 1, 1),
          npcAt('guard', 4, 7),
          npcAt('merchant', 2, 2),
          npcAt('imposter', 4, 7),
        ],
      }),
    ).toThrow('Invalid NPC JSON: npcs[3] occupies the same tile (4,7) as npcs[1].');
  });
});
