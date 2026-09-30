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

describe('stampSimpleDungeon furniture seed isolation', () => {
  const options = {
    width: 12,
    height: 12,
    groundTileId: GROUND,
    wallTileId: WALL,
    roomCount: 1,
    minRoomSize: 10,
    maxRoomSize: 10,
    furnitureTileId: 9001,
    furnitureDensity: 0.5,
  };

  it('gives adjacent layout seeds distinct furniture placements in the same room', () => {
    const first = stampSimpleDungeon({ ...options, seed: 0 });
    const second = stampSimpleDungeon({ ...options, seed: 1 });

    expect(first.rooms).toEqual(second.rooms);
    expect(first.furnitureCount).toBeGreaterThan(0);
    expect(second.layers[1]).not.toEqual(first.layers[1]);
  });

  it('preserves furniture placement when only the ground tile changes', () => {
    const first = stampSimpleDungeon({ ...options, seed: 42 });
    const repainted = stampSimpleDungeon({ ...options, seed: 42, groundTileId: GROUND + 1 });

    expect(first.furnitureCount).toBeGreaterThan(0);
    expect(repainted.layers[1]).toEqual(first.layers[1]);
  });
});

describe('stampSimpleDungeon oversized corridor boundaries', () => {
  const options = {
    width: 16,
    height: 12,
    seed: 42,
    groundTileId: GROUND,
    wallTileId: WALL,
    roomCount: 2,
    minRoomSize: 3,
    maxRoomSize: 3,
    corridorWidth: 32,
    tightBorder: true,
  };

  it('carves the first interior column when a wide corridor reaches the west border', () => {
    const stamp = stampSimpleDungeon(options);

    expect(stamp.rooms).toHaveLength(2);
    for (let y = 2; y < options.height - 2; y++) {
      const index = y * options.width + 2;
      expect([stamp.layers[0][index], stamp.layers[2][index]]).toEqual([GROUND, 0]);
    }
  });

  it('carves the first interior row when a wide corridor reaches the north border', () => {
    const stamp = stampSimpleDungeon(options);

    expect(stamp.rooms).toHaveLength(2);
    for (let x = 2; x < options.width - 2; x++) {
      const index = 2 * options.width + x;
      expect([stamp.layers[0][index], stamp.layers[2][index]]).toEqual([GROUND, 0]);
    }
  });

  it('preserves the empty east outer ring when a wide corridor reaches the border', () => {
    const stamp = stampSimpleDungeon(options);
    const eastEdge = Array.from(
      { length: options.height },
      (_, y) => stamp.layers[0][y * options.width + options.width - 1],
    );

    expect(stamp.rooms).toHaveLength(2);
    expect(eastEdge).toEqual(new Array(options.height).fill(0));
  });

  it('preserves the empty south outer ring when a wide corridor reaches the border', () => {
    const stamp = stampSimpleDungeon(options);

    expect(stamp.rooms).toHaveLength(2);
    expect(stamp.layers[0].slice((options.height - 1) * options.width)).toEqual(
      new Array(options.width).fill(0),
    );
  });
});

describe('stampSimpleDungeon', () => {
  it('places a second room with exactly one separating column west of the first', () => {
    const stamp = stampSimpleDungeon({
      width: 10,
      height: 8,
      seed: 7,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 2,
      minRoomSize: 3,
      maxRoomSize: 3,
    });

    expect(stamp.rooms.map((room) => ({ x: room.x, width: room.w }))).toEqual([
      { x: 5, width: 3 },
      { x: 1, width: 3 },
    ]);
  });

  it('carves the full corridor width at the east endpoint beside a smaller room', () => {
    const width = 14;
    const stamp = stampSimpleDungeon({
      width,
      height: 10,
      seed: 1,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 2,
      minRoomSize: 3,
      maxRoomSize: 3,
      corridorWidth: 4,
    });
    const [eastRoom, westRoom] = stamp.rooms;
    if (!eastRoom || !westRoom) throw new Error('fixture needs two rooms');
    expect(eastRoom.x).toBeGreaterThan(westRoom.x);
    const centerX = eastRoom.x + Math.floor(eastRoom.w / 2);
    const centerY = eastRoom.y + Math.floor(eastRoom.h / 2);

    // A four-tile corridor spans offsets -1 through +2 around its endpoint.
    for (const dy of [-1, 0, 1, 2]) {
      const index = (centerY + dy) * width + centerX + 2;
      expect([stamp.layers[0][index], stamp.layers[2][index]]).toEqual([GROUND, 0]);
    }
  });

  it('carves the full corridor width at the south endpoint beside a smaller room', () => {
    const width = 14;
    const stamp = stampSimpleDungeon({
      width,
      height: 10,
      seed: 0,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 2,
      minRoomSize: 3,
      maxRoomSize: 3,
      corridorWidth: 4,
    });
    const [northRoom, southRoom] = stamp.rooms;
    if (!northRoom || !southRoom) throw new Error('fixture needs two rooms');
    expect(southRoom.y).toBeGreaterThan(northRoom.y);
    const centerX = southRoom.x + Math.floor(southRoom.w / 2);
    const centerY = southRoom.y + Math.floor(southRoom.h / 2);

    for (const dx of [-1, 0, 1, 2]) {
      const index = (centerY + 2) * width + centerX + dx;
      expect([stamp.layers[0][index], stamp.layers[2][index]]).toEqual([GROUND, 0]);
    }
  });

  it('keeps oversized rooms within the map width', () => {
    const width = 8;
    const stamp = stampSimpleDungeon({
      width,
      height: 12,
      seed: 1,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 1,
      minRoomSize: 20,
      maxRoomSize: 20,
    });

    expect(stamp.rooms).toHaveLength(1);
    for (const room of stamp.rooms) {
      expect(room.x + room.w).toBeLessThanOrEqual(width);
    }
  });

  it('keeps oversized rooms within the map height', () => {
    const height = 8;
    const stamp = stampSimpleDungeon({
      width: 12,
      height,
      seed: 1,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 1,
      minRoomSize: 20,
      maxRoomSize: 20,
    });

    expect(stamp.rooms).toHaveLength(1);
    for (const room of stamp.rooms) {
      expect(room.y + room.h).toBeLessThanOrEqual(height);
    }
  });

  it('centers the fallback hall horizontally on a wide map', () => {
    const width = 12;
    const height = 8;
    const stamp = stampSimpleDungeon({
      width,
      height,
      seed: 1,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 0,
    });
    const centerRow = Math.floor(height / 2);
    const row = stamp.layers[0].slice(centerRow * width, (centerRow + 1) * width);

    expect(stamp.rooms).toEqual([]);
    expect(row).toContain(GROUND);
    expect(row).toEqual([...row].reverse());
  });

  it('centers the fallback hall vertically on a tall map', () => {
    const width = 8;
    const height = 12;
    const stamp = stampSimpleDungeon({
      width,
      height,
      seed: 1,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 0,
    });
    const centerColumn = Math.floor(width / 2);
    const column = Array.from(
      { length: height },
      (_, y) => stamp.layers[0][y * width + centerColumn],
    );

    expect(stamp.rooms).toEqual([]);
    expect(column).toContain(GROUND);
    expect(column).toEqual([...column].reverse());
  });

  it('uses sparse default furniture placement when density is omitted', () => {
    const options = {
      width: 12,
      height: 12,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 1,
      minRoomSize: 10,
      maxRoomSize: 10,
      furnitureTileId: 9001,
    };
    const sparse = stampSimpleDungeon(options);
    const full = stampSimpleDungeon({ ...options, furnitureDensity: 1 });

    expect(sparse.furnitureCount).toBeGreaterThan(0);
    expect(sparse.furnitureCount).toBeLessThan(full.furnitureCount);
  });

  it('places furniture whose tile ID is lower than the ground tile ID', () => {
    const stamp = stampSimpleDungeon({
      width: 12,
      height: 12,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 1,
      minRoomSize: 10,
      maxRoomSize: 10,
      furnitureTileId: 1,
      furnitureDensity: 1,
    });

    expect(stamp.furnitureCount).toBeGreaterThan(0);
    expect(stamp.layers[1]).toContain(1);
  });

  it('places furniture whose tile ID is lower than the door tile ID', () => {
    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: 5001,
      furnitureTileId: 4001,
      furnitureDensity: 1,
      roomCount: 5,
    });

    expect(stamp.doors.length).toBeGreaterThan(0);
    expect(stamp.furnitureCount).toBeGreaterThan(0);
    expect(stamp.layers[1]).toContain(4001);
  });

  it('places a second room with exactly one separating row below the first', () => {
    const stamp = stampSimpleDungeon({
      width: 8,
      height: 10,
      seed: 0,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 2,
      minRoomSize: 3,
      maxRoomSize: 3,
    });

    expect(stamp.rooms).toHaveLength(2);
    expect(stamp.rooms.map((room) => ({ y: room.y, height: room.h }))).toEqual([
      { y: 1, height: 3 },
      { y: 5, height: 3 },
    ]);
  });

  it('places no furniture when its density is explicitly zero', () => {
    const stamp = stampSimpleDungeon({
      width: 16,
      height: 16,
      seed: 7,
      groundTileId: GROUND,
      wallTileId: WALL,
      furnitureTileId: 9001,
      furnitureDensity: 0,
      roomCount: 1,
      minRoomSize: 4,
      maxRoomSize: 4,
    });

    expect(stamp.rooms).toHaveLength(1);
    expect(stamp.furnitureCount).toBe(0);
    expect(stamp.layers[1].every((id) => id === 0)).toBe(true);
  });

  it('leaves furniture empty when its tile id is the door tile', () => {
    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: 5001,
      furnitureTileId: 5001,
      furnitureDensity: 1,
    });

    expect(stamp.doors.length).toBeGreaterThan(0);
    expect(stamp.furnitureCount).toBe(0);
    expect(stamp.layers[1].filter((id) => id === 5001)).toHaveLength(stamp.doors.length);
  });

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
  it('furnishes valid rows beyond the map width on a tall map', () => {
    const mid = new Array<number>(21).fill(0);

    const count = scatterFurnitureInRooms([{ x: 0, y: 3, w: 3, h: 3 }], mid, 3, 7, 9, 1, () => 0);

    expect(count).toBe(1);
    expect(mid.flatMap((id, index) => (id === 9 ? [index] : []))).toEqual([13]);
  });

  it('furnishes valid columns beyond the map height on a wide map', () => {
    const mid = new Array<number>(21).fill(0);

    const count = scatterFurnitureInRooms([{ x: 3, y: 0, w: 3, h: 3 }], mid, 7, 3, 9, 1, () => 0);

    expect(count).toBe(1);
    expect(mid.flatMap((id, index) => (id === 9 ? [index] : []))).toEqual([11]);
  });

  it('places furniture tile ID one in an empty room interior', () => {
    const mid = new Array<number>(9).fill(0);

    const count = scatterFurnitureInRooms([{ x: 0, y: 0, w: 3, h: 3 }], mid, 3, 3, 1, 1, () => 0);

    expect(count).toBe(1);
    expect(mid).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it('does not wrap a clipped furniture interior west into the preceding row', () => {
    const mid = new Array<number>(12).fill(0);

    const count = scatterFurnitureInRooms([{ x: -2, y: 0, w: 4, h: 3 }], mid, 4, 3, 9, 1, () => 0);

    expect(count).toBe(1);
    expect(mid.flatMap((id, index) => (id === 9 ? [index] : []))).toEqual([4]);
  });

  it('does not count empty tile ID zero as placed furniture', () => {
    const mid = new Array<number>(9).fill(0);

    const count = scatterFurnitureInRooms([{ x: 0, y: 0, w: 3, h: 3 }], mid, 3, 3, 0, 1, () => 0);

    expect(count).toBe(0);
    expect(mid).toEqual(new Array<number>(9).fill(0));
  });

  it('leaves room interiors unchanged for a negative furniture tile ID', () => {
    const mid = new Array<number>(9).fill(0);

    const count = scatterFurnitureInRooms([{ x: 0, y: 0, w: 3, h: 3 }], mid, 3, 3, -1, 1, () => 0);

    expect(count).toBe(0);
    expect(mid).toEqual(new Array<number>(9).fill(0));
  });

  it('furnishes column zero when a clipped room interior reaches the west edge', () => {
    const mid = new Array<number>(12).fill(0);
    const count = scatterFurnitureInRooms([{ x: -1, y: 0, w: 3, h: 3 }], mid, 4, 3, 9, 1, () => 0);

    expect(count).toBe(1);
    expect(mid.flatMap((id, index) => (id === 9 ? [index] : []))).toEqual([4]);
  });

  it('furnishes row zero when a clipped room interior reaches the north edge', () => {
    const mid = new Array<number>(12).fill(0);
    const count = scatterFurnitureInRooms([{ x: 0, y: -1, w: 3, h: 3 }], mid, 4, 3, 9, 1, () => 0);

    expect(count).toBe(1);
    expect(mid.flatMap((id, index) => (id === 9 ? [index] : []))).toEqual([1]);
  });

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

  it('preserves a negative occupied cell inside a room interior', () => {
    const mid = new Array<number>(9).fill(0);
    mid[4] = -1;

    const count = scatterFurnitureInRooms([{ x: 0, y: 0, w: 3, h: 3 }], mid, 3, 3, 9, 1, () => 0);

    expect(count).toBe(0);
    expect(mid[4]).toBe(-1);
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
  it('selects a larger main room even below the sum of earlier room areas', () => {
    const spawn = pickMainRoomSpawn(
      [
        { x: 1, y: 1, w: 2, h: 2 },
        { x: 5, y: 1, w: 3, h: 3 },
        { x: 10, y: 1, w: 4, h: 3 },
      ],
      20,
      10,
    );

    expect(spawn).toEqual({ x: 12, y: 2 });
  });

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
  it('finds a door in a valid row beyond the width on a tall map', () => {
    const width = 3;
    const height = 7;
    const walkable = new Uint8Array(width * height);
    walkable[4 * width + 1] = 1;
    walkable[4 * width + 2] = 1;

    expect(findDoorOpenings([{ x: 1, y: 4, w: 1, h: 1 }], walkable, width, height)).toEqual([
      { x: 1, y: 4 },
    ]);
  });

  it('finds a door whose south neighbor reaches the width on a tall map', () => {
    const width = 3;
    const height = 7;
    const walkable = new Uint8Array(width * height);
    walkable[2 * width + 1] = 1;
    walkable[3 * width + 1] = 1;

    expect(findDoorOpenings([{ x: 1, y: 2, w: 1, h: 1 }], walkable, width, height)).toEqual([
      { x: 1, y: 2 },
    ]);
  });

  it('reports a shared door opening only once across overlapping rooms', () => {
    const walkable = new Uint8Array(25);
    walkable[2 * 5 + 3] = 1;
    walkable[2 * 5 + 4] = 1;

    expect(
      findDoorOpenings(
        [
          { x: 1, y: 1, w: 3, h: 3 },
          { x: 3, y: 1, w: 1, h: 3 },
        ],
        walkable,
        5,
        5,
      ),
    ).toEqual([{ x: 3, y: 2 }]);
  });

  it('paints door tile ID one at every generated opening', () => {
    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: 1,
      roomCount: 5,
    });

    expect(stamp.doors.length).toBeGreaterThan(0);
    for (const door of stamp.doors) {
      expect(stamp.layers[1][door.y * 32 + door.x]).toBe(1);
    }
  });

  it('rejects a room edge at map width instead of wrapping it into the next row', () => {
    const walkable = new Uint8Array(12);
    walkable[7] = 1;
    walkable[8] = 1;

    expect(findDoorOpenings([{ x: 4, y: 1, w: 1, h: 1 }], walkable, 4, 3)).toEqual([]);
  });

  it('ignores a room edge west of the map even when its wrapped cell is walkable', () => {
    const walkable = new Uint8Array(12);
    walkable[3] = 1;
    walkable[4] = 1;

    expect(findDoorOpenings([{ x: -1, y: 1, w: 1, h: 1 }], walkable, 4, 3)).toEqual([]);
  });

  it('does not treat the preceding row as a west-edge door neighbor', () => {
    const walkable = new Uint8Array(12);
    walkable[3] = 1;
    walkable[4] = 1;

    expect(findDoorOpenings([{ x: 0, y: 1, w: 1, h: 1 }], walkable, 4, 3)).toEqual([]);
  });

  it('does not create door openings for a zero-height room', () => {
    const walkable = new Uint8Array(25).fill(1);

    expect(findDoorOpenings([{ x: 1, y: 1, w: 3, h: 0 }], walkable, 5, 5)).toEqual([]);
  });

  it('does not create door openings for a zero-width room', () => {
    const walkable = new Uint8Array(25).fill(1);

    expect(findDoorOpenings([{ x: 1, y: 1, w: 0, h: 3 }], walkable, 5, 5)).toEqual([]);
  });

  it('finds a door in column zero that opens east into a corridor', () => {
    const walkable = new Uint8Array(12);
    walkable[4] = 1;
    walkable[5] = 1;

    expect(findDoorOpenings([{ x: 0, y: 1, w: 1, h: 1 }], walkable, 4, 3)).toEqual([
      { x: 0, y: 1 },
    ]);
  });

  it('finds a door in row zero that opens south into a corridor', () => {
    const walkable = new Uint8Array(12);
    walkable[1] = 1;
    walkable[5] = 1;

    expect(findDoorOpenings([{ x: 1, y: 0, w: 1, h: 1 }], walkable, 4, 3)).toEqual([
      { x: 1, y: 0 },
    ]);
  });

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

  it('does not paint a negative door tile id at openings', () => {
    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 42,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: -1,
      roomCount: 5,
    });

    expect(stamp.doors.length).toBeGreaterThan(0);
    expect(stamp.layers[1].every((id) => id !== -1)).toBe(true);
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
