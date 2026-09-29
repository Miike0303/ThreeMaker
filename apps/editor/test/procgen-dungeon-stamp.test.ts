import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  findDoorOpenings,
  pickMainRoomSpawn,
  scatterFurnitureInRooms,
  stampSimpleDungeon,
} from '../src/procgen/dungeon-stamp.js';

const GROUND = 2816;
const WALL = 4352;

describe('stampSimpleDungeon', () => {
  it('carves a walkable center hall when no rooms are requested', () => {
    const stamp = stampSimpleDungeon({
      width: 12,
      height: 10,
      seed: 1,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 0,
    });

    expect(stamp.rooms).toEqual([]);
    expect(stamp.layers[0][5 * 12 + 6]).toBe(GROUND);
    expect(stamp.layers[2][5 * 12 + 6]).toBe(0);
  });

  it('rejects a zero wall tile ID with a nonzero ground tile', () => {
    expect(() =>
      stampSimpleDungeon({
        width: 16,
        height: 16,
        seed: 1,
        groundTileId: GROUND,
        wallTileId: 0,
      }),
    ).toThrow(/non-zero tile ids/);
  });

  it('clamps a zero corridor width to a one-tile passage', () => {
    const options = {
      width: 24,
      height: 18,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
    };
    const minimum = stampSimpleDungeon({ ...options, corridorWidth: 1 });
    const zero = stampSimpleDungeon({ ...options, corridorWidth: 0 });

    expect(minimum.rooms.length).toBeGreaterThan(1);
    expect(zero.layers).toEqual(minimum.layers);
  });

  it('rejects a map with only one undersized dimension', () => {
    for (const dimensions of [
      { width: 7, height: 8 },
      { width: 8, height: 7 },
    ]) {
      expect(() =>
        stampSimpleDungeon({
          ...dimensions,
          seed: 1,
          groundTileId: GROUND,
          wallTileId: WALL,
        }),
      ).toThrow(/width\/height >= 8/);
    }
  });

  it('leaves furniture empty when its tile id is the ground tile', () => {
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 1,
      groundTileId: GROUND,
      wallTileId: WALL,
      furnitureTileId: GROUND,
      furnitureDensity: 1,
      roomCount: 1,
      minRoomSize: 4,
      maxRoomSize: 4,
    });

    expect(stamp.rooms).toHaveLength(1);
    expect(stamp.furnitureCount).toBe(0);
    expect(stamp.layers[1].every((id) => id === 0)).toBe(true);
  });

  it('keeps row zero empty when tightBorder is enabled', () => {
    const stamp = stampSimpleDungeon({
      width: 24,
      height: 20,
      seed: 3,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 1,
      minRoomSize: 5,
      maxRoomSize: 9,
      tightBorder: true,
    });

    expect(stamp.layers[0].slice(0, 24).every((id) => id === 0)).toBe(true);
    expect(stamp.layers[2].slice(0, 24).every((id) => id === 0)).toBe(true);
  });

  it('carves more ground at corridor width 2 than width 1', () => {
    const options = {
      width: 24,
      height: 18,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
    };
    const narrow = stampSimpleDungeon({ ...options, corridorWidth: 1 });
    const wide = stampSimpleDungeon({ ...options, corridorWidth: 2 });
    expect(wide.layers).not.toEqual(narrow.layers);
    expect(wide.layers[0].filter((id) => id === GROUND).length).toBeGreaterThan(
      narrow.layers[0].filter((id) => id === GROUND).length,
    );
  });

  it('preserves the exact width-3 stamp from the symmetric span', () => {
    const stamp = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      corridorWidth: 3,
    });
    const hash = createHash('sha256').update(JSON.stringify(stamp)).digest('hex');
    expect(hash).toBe('284dba98e98e45a37f769f325374d9a64ed7f9936ee38c47daf02ae6f270b383');
  });

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

  it('accepts an eight-tile-wide map at the minimum size', () => {
    const stamp = stampSimpleDungeon({
      width: 8,
      height: 8,
      seed: 1,
      groundTileId: GROUND,
      wallTileId: WALL,
    });
    expect(stamp.layers[0]).toHaveLength(64);
  });
});

describe('scatterFurnitureInRooms', () => {
  it('preserves occupied interior cells while furnishing the remaining cells', () => {
    const mid = new Array<number>(25).fill(0);
    mid[12] = 5001;

    const count = scatterFurnitureInRooms([{ x: 0, y: 0, w: 5, h: 5 }], mid, 5, 5, 9, 1, () => 0);

    expect(mid[12]).toBe(5001);
    expect(count).toBe(8);
    expect(mid.filter((id) => id === 9)).toHaveLength(8);
  });

  it('places furniture in the single interior column of a three-tile-wide room', () => {
    const mid = new Array<number>(42).fill(0);
    const count = scatterFurnitureInRooms([{ x: 1, y: 1, w: 3, h: 5 }], mid, 6, 7, 9, 1, () => 0);

    expect(count).toBe(3);
    expect(mid.flatMap((id, index) => (id === 9 ? [index] : []))).toEqual([14, 20, 26]);
  });

  it('ignores furniture interior cells beyond the right map edge', () => {
    const mid = new Array<number>(16).fill(0);
    const count = scatterFurnitureInRooms([{ x: 2, y: 0, w: 4, h: 3 }], mid, 4, 4, 9, 1, () => 0);

    expect(count).toBe(1);
    expect(mid).toEqual([0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('leaves a room cell empty when the random draw equals density', () => {
    const mid = new Array(9).fill(0);
    const count = scatterFurnitureInRooms(
      [{ x: 0, y: 0, w: 3, h: 3 }],
      mid,
      3,
      3,
      9,
      0.5,
      () => 0.5,
    );
    expect(count).toBe(0);
    expect(mid[4]).toBe(0);
  });
});

describe('pickMainRoomSpawn', () => {
  it('uses the center row of an odd-height map when no rooms were placed', () => {
    expect(pickMainRoomSpawn([], 8, 9)).toEqual({ x: 4, y: 4 });
  });

  it('uses the center column of an odd-width map when no rooms were placed', () => {
    expect(pickMainRoomSpawn([], 9, 8)).toEqual({ x: 4, y: 4 });
  });

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

describe('stampSimpleDungeon door openings', () => {
  it('finds an opening whose outside neighbor is in row zero', () => {
    const walkable = new Uint8Array(12);
    walkable[1] = 1;
    walkable[5] = 1;

    expect(findDoorOpenings([{ x: 1, y: 1, w: 1, h: 1 }], walkable, 4, 3)).toEqual([
      { x: 1, y: 1 },
    ]);
  });

  it('finds an opening whose outside neighbor is in column zero', () => {
    const walkable = new Uint8Array(12);
    walkable[4] = 1;
    walkable[5] = 1;

    expect(findDoorOpenings([{ x: 1, y: 1, w: 1, h: 1 }], walkable, 4, 3)).toEqual([
      { x: 1, y: 1 },
    ]);
  });

  it('finds a bottom-edge opening in a two-row room', () => {
    const walkable = new Uint8Array(30);
    for (const y of [1, 2]) {
      for (const x of [1, 2, 3]) walkable[y * 6 + x] = 1;
    }
    walkable[3 * 6 + 2] = 1;

    expect(findDoorOpenings([{ x: 1, y: 1, w: 3, h: 2 }], walkable, 6, 5)).toEqual([
      { x: 2, y: 2 },
    ]);
  });

  it('finds a right-edge opening in a two-column room', () => {
    const walkable = new Uint8Array(30);
    for (const y of [1, 2, 3]) {
      for (const x of [1, 2]) walkable[y * 5 + x] = 1;
    }
    walkable[2 * 5 + 3] = 1;

    expect(findDoorOpenings([{ x: 1, y: 1, w: 2, h: 3 }], walkable, 5, 6)).toEqual([
      { x: 2, y: 2 },
    ]);
  });

  it('does not wrap an east-edge door neighbor into the next row', () => {
    const walkable = new Uint8Array(16);
    walkable[7] = 1;
    walkable[8] = 1;

    expect(findDoorOpenings([{ x: 3, y: 1, w: 1, h: 1 }], walkable, 4, 4)).toEqual([]);
  });

  const DOOR = 5001;

  it('reports door openings on room edges where corridors leave', () => {
    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 5,
    });
    expect(stamp.rooms.length).toBeGreaterThan(1);
    expect(stamp.doors.length).toBeGreaterThan(0);
    for (const d of stamp.doors) {
      const i = d.y * 32 + d.x;
      // Door sits on walkable ground, never under a wall tile.
      expect(stamp.layers[0][i]).toBe(GROUND);
      expect(stamp.layers[2][i]).toBe(0);
      // Must sit on some room perimeter.
      const onRoomEdge = stamp.rooms.some(
        (r) =>
          d.x >= r.x &&
          d.x < r.x + r.w &&
          d.y >= r.y &&
          d.y < r.y + r.h &&
          (d.x === r.x || d.x === r.x + r.w - 1 || d.y === r.y || d.y === r.y + r.h - 1),
      );
      expect(onRoomEdge).toBe(true);
    }
  });

  it('paints optional door tiles on mid layer at openings', () => {
    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: DOOR,
      roomCount: 5,
    });
    expect(stamp.doors.length).toBeGreaterThan(0);
    for (const d of stamp.doors) {
      const i = d.y * 32 + d.x;
      expect(stamp.layers[1][i]).toBe(DOOR);
    }
    // Mid is empty except doors.
    const midNonZero = stamp.layers[1].filter((id) => id !== 0).length;
    expect(midNonZero).toBe(stamp.doors.length);
  });

  it('leaves mid empty when doorTileId is omitted', () => {
    const stamp = stampSimpleDungeon({
      width: 24,
      height: 18,
      seed: 7,
      groundTileId: GROUND,
      wallTileId: WALL,
    });
    expect(stamp.layers[1].every((id) => id === 0)).toBe(true);
  });

  it('is still deterministic including doors for the same seed', () => {
    const opts = {
      width: 28,
      height: 20,
      seed: 99,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: DOOR,
      roomCount: 4,
    };
    const a = stampSimpleDungeon(opts);
    const b = stampSimpleDungeon(opts);
    expect(a.doors).toEqual(b.doors);
    expect(a.layers[1]).toEqual(b.layers[1]);
    expect(a.furnitureCount).toBe(0);
  });

  it('scatters furniture on mid without overwriting doors', () => {
    const FURN = 9001;
    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: DOOR,
      furnitureTileId: FURN,
      furnitureDensity: 0.5,
      roomCount: 5,
    });
    expect(stamp.furnitureCount).toBeGreaterThan(0);
    for (const d of stamp.doors) {
      const i = d.y * 32 + d.x;
      expect(stamp.layers[1][i]).toBe(DOOR);
    }
    const midFurn = stamp.layers[1].filter((id) => id === FURN).length;
    expect(midFurn).toBe(stamp.furnitureCount);
    // Layout without furniture still matches room/door structure
    const bare = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: DOOR,
      roomCount: 5,
    });
    expect(stamp.rooms).toEqual(bare.rooms);
    expect(stamp.doors).toEqual(bare.doors);
    expect(stamp.layers[0]).toEqual(bare.layers[0]);
    expect(stamp.layers[2]).toEqual(bare.layers[2]);
  });

  it('furniture scatter is deterministic for the same seed', () => {
    const opts = {
      width: 28,
      height: 20,
      seed: 123,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: DOOR,
      furnitureTileId: 777,
      furnitureDensity: 0.2,
      roomCount: 4,
    };
    expect(stampSimpleDungeon(opts)).toEqual(stampSimpleDungeon(opts));
  });
});
