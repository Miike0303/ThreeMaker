import { describe, expect, it } from 'vitest';
import { stampSimpleDungeon } from '../src/procgen/dungeon-stamp.js';

const GROUND = 2816;
const WALL = 4352;

describe('stampSimpleDungeon', () => {
  it('is deterministic for the same seed', () => {
    const a = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
    });
    const b = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
    });
    expect(a.layers[0]).toEqual(b.layers[0]);
    expect(a.layers[2]).toEqual(b.layers[2]);
    expect(a.rooms).toEqual(b.rooms);
  });

  it('differs when the seed changes', () => {
    const a = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 1,
      groundTileId: GROUND,
      wallTileId: WALL,
    });
    const b = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 2,
      groundTileId: GROUND,
      wallTileId: WALL,
    });
    expect(a.layers[0]).not.toEqual(b.layers[0]);
  });

  it('paints ground on layer 0 and walls on layer 2; mid/over stay empty', () => {
    const stamp = stampSimpleDungeon({
      width: 20,
      height: 16,
      seed: 7,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 5,
    });
    const [ground, mid, wall, over] = stamp.layers;
    expect(ground.some((id) => id === GROUND)).toBe(true);
    expect(wall.some((id) => id === WALL)).toBe(true);
    expect(mid.every((id) => id === 0)).toBe(true);
    expect(over.every((id) => id === 0)).toBe(true);
    // Every wall cell sits on ground (walkable border).
    for (let i = 0; i < wall.length; i++) {
      if (wall[i] === WALL) expect(ground[i]).toBe(GROUND);
    }
  });

  it('rejects tiny maps and zero tile ids', () => {
    expect(() =>
      stampSimpleDungeon({
        width: 4,
        height: 4,
        seed: 1,
        groundTileId: GROUND,
        wallTileId: WALL,
      }),
    ).toThrow(/>= 8/);
    expect(() =>
      stampSimpleDungeon({
        width: 16,
        height: 16,
        seed: 1,
        groundTileId: 0,
        wallTileId: WALL,
      }),
    ).toThrow(/non-zero/);
  });
});
