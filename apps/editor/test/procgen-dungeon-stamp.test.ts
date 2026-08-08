import { describe, expect, it } from 'vitest';
import { pickMainRoomSpawn, stampSimpleDungeon } from '../src/procgen/dungeon-stamp.js';

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

describe('pickMainRoomSpawn', () => {
  it('returns the center of the largest room by area', () => {
    const spawn = pickMainRoomSpawn(
      [
        { x: 2, y: 2, w: 4, h: 4 },
        { x: 10, y: 4, w: 8, h: 6 },
        { x: 3, y: 12, w: 3, h: 3 },
      ],
      24,
      20,
    );
    // Largest is 8x6 at (10,4) → center (10+4, 4+3) = (14, 7)
    expect(spawn).toEqual({ x: 14, y: 7 });
  });

  it('breaks area ties by keeping the first room in order', () => {
    const spawn = pickMainRoomSpawn(
      [
        { x: 1, y: 1, w: 5, h: 5 },
        { x: 10, y: 10, w: 5, h: 5 },
      ],
      20,
      20,
    );
    expect(spawn).toEqual({ x: 3, y: 3 });
  });

  it('falls back to map center when no rooms were placed', () => {
    expect(pickMainRoomSpawn([], 20, 16)).toEqual({ x: 10, y: 8 });
  });

  it('clamps fallback spawn inside the map for tiny sizes', () => {
    expect(pickMainRoomSpawn([], 8, 8)).toEqual({ x: 4, y: 4 });
  });

  it('lands on walkable ground for a real stamp', () => {
    const stamp = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 6,
    });
    const spawn = pickMainRoomSpawn(stamp.rooms, 24, 18);
    const i = spawn.y * 24 + spawn.x;
    expect(stamp.layers[0][i]).toBe(GROUND);
    expect(stamp.layers[2][i]).toBe(0);
  });
});
