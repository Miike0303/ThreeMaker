import { describe, expect, it } from 'vitest';
import {
  firstClassedTileId,
  majorityClassedTileId,
  majorityNonZeroTileId,
  resolveDungeonTileIds,
} from '../src/procgen/tile-pick.js';

describe('firstClassedTileId', () => {
  it('selects tile ID one when it is the lowest matching semantic tile', () => {
    expect(firstClassedTileId({ '1': { class: 'wall' }, '88': { class: 'wall' } }, 'wall')).toBe(1);
  });

  it('ignores negative semantic tile IDs', () => {
    expect(firstClassedTileId({ '-5': { class: 'wall' }, '88': { class: 'wall' } }, 'wall')).toBe(
      88,
    );
  });
  it('ignores semantic tile ID zero when choosing a wall', () => {
    expect(firstClassedTileId({ '0': { class: 'wall' }, '88': { class: 'wall' } }, 'wall')).toBe(
      88,
    );
  });
});

describe('majorityNonZeroTileId', () => {
  it('returns undefined for empty/zero layers', () => {
    expect(majorityNonZeroTileId([])).toBeUndefined();
    expect(majorityNonZeroTileId([0, 0, 0])).toBeUndefined();
  });

  it('picks the most frequent non-zero id', () => {
    expect(majorityNonZeroTileId([1, 2, 2, 0, 2, 1])).toBe(2);
  });

  it('keeps the first id to reach the best count on a tie', () => {
    expect(majorityNonZeroTileId([1, 2])).toBe(1);
    // 1 reaches count 2 before 2 does.
    expect(majorityNonZeroTileId([2, 1, 1, 2])).toBe(1);
  });
});

describe('majorityClassedTileId', () => {
  it('keeps the first same-class id to reach the best count on a tie', () => {
    expect(
      majorityClassedTileId(
        [2, 1, 1, 2],
        { '1': { class: 'wall' }, '2': { class: 'wall' } },
        'wall',
      ),
    ).toBe(1);
  });
});

describe('resolveDungeonTileIds', () => {
  it('prefers painted furniture below the ground tile ID over unused semantics', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 90,
      groundLayer: [],
      wallLayer: [],
      midLayer: [80, 80, 70],
      fallbackGround: 10,
      fallbackWall: 100,
      semantics: { '70': { class: 'furniture' }, '80': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBe(80);
  });

  it('prefers a painted door majority below the ground tile ID over unused semantics', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 90,
      groundLayer: [],
      wallLayer: [],
      midLayer: [80, 80],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: { '70': { class: 'door' }, '80': { class: 'door' } },
    });

    expect(tiles.doorTileId).toBe(80);
  });

  it('prefers a painted door majority below the wall tile ID over unused semantics', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 10,
      groundLayer: [],
      wallLayer: [],
      midLayer: [80, 80],
      fallbackGround: 10,
      fallbackWall: 90,
      semantics: { '70': { class: 'door' }, '80': { class: 'door' } },
    });

    expect(tiles.doorTileId).toBe(80);
  });

  it('prefers a painted furniture majority below the wall tile ID over unused semantics', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 10,
      groundLayer: [],
      wallLayer: [],
      midLayer: [80, 80],
      fallbackGround: 10,
      fallbackWall: 90,
      semantics: { '70': { class: 'furniture' }, '80': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBe(80);
  });

  it('selects semantic door tile ID one without an override or painted door', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 10,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: { '1': { class: 'door' }, '77': { class: 'door' } },
    });

    expect(tiles.doorTileId).toBe(1);
  });

  it('selects semantic furniture tile ID one without an override or painted furniture', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 10,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: { '1': { class: 'furniture' }, '200': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBe(1);
  });

  it('uses wall override tile ID one ahead of an automatic wall', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 10,
      groundLayer: [],
      wallLayer: [90, 90],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: 1,
      semantics: { '90': { class: 'wall' } },
    });

    expect(tiles.wallTileId).toBe(1);
  });

  it('uses furniture override tile ID one ahead of the painted furniture', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 10,
      groundLayer: [],
      wallLayer: [],
      midLayer: [200, 200],
      fallbackGround: 10,
      fallbackWall: 20,
      furnitureTileOverride: 1,
      semantics: { '200': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBe(1);
  });

  it('uses a distinct wall fallback when the explicit wall override matches ground', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 7,
      groundLayer: [],
      wallLayer: [9, 9],
      fallbackGround: 7,
      fallbackWall: 20,
      wallTileOverride: 7,
    });

    expect(tiles.wallTileId).toBe(20);
  });

  it('uses door override tile ID one ahead of an automatic semantic door', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 10,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      doorTileOverride: 1,
      semantics: { '77': { class: 'door' } },
    });

    expect(tiles.doorTileId).toBe(1);
  });

  it('prefers a painted wall-class tile over a lower unused wall semantic', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [7, 7, 90],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: {
        '7': { class: 'furniture' },
        '80': { class: 'wall' },
        '90': { class: 'wall' },
      },
    });

    expect(tiles.wallTileId).toBe(90);
  });

  it('prefers the furniture majority on the mid layer over a lower semantic ID', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      midLayer: [201, 201, 200],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: { '200': { class: 'furniture' }, '201': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBe(201);
  });

  it('uses door auto-pick for a negative door override', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      doorTileOverride: -1,
      semantics: { '77': { class: 'door' } },
    });

    expect(tiles.doorTileId).toBe(77);
  });

  it('uses furniture auto-pick for a negative furniture override', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      furnitureTileOverride: -1,
      semantics: { '200': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBe(200);
  });

  it('uses the ground fallback when brush and ground layer are empty', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 0,
      groundLayer: [0, 0],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
    });

    expect(tiles.groundTileId).toBe(10);
  });

  it('uses wall auto-pick for a negative wall override', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [9, 9],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: -1,
    });

    expect(tiles.wallTileId).toBe(9);
  });

  it('uses ground auto-pick for a negative brush fill', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: -1,
      groundLayer: [3, 3, 4],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
    });

    expect(tiles.groundTileId).toBe(3);
  });

  it('uses wall auto-pick for a zero override', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [9, 9],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: 0,
    });

    expect(tiles.wallTileId).toBe(9);
  });

  it('uses furniture auto-pick for a zero override', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      furnitureTileOverride: 0,
      semantics: { '200': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBe(200);
  });

  it('excludes ground from mid-layer door selection', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 80,
      groundLayer: [],
      wallLayer: [],
      midLayer: [80, 80, 77],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: { '77': { class: 'door' }, '80': { class: 'door' } },
    });

    expect(tiles.doorTileId).toBe(77);
  });

  it('excludes wall from mid-layer furniture selection', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      midLayer: [333, 333, 200],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: 333,
      semantics: { '200': { class: 'furniture' }, '333': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBe(200);
  });

  it('omits a semantic door that collides with the wall', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: 77,
      semantics: { '77': { class: 'door' } },
    });

    expect(tiles.doorTileId).toBeUndefined();
  });

  it('omits semantic furniture that collides with the wall', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: 200,
      semantics: { '200': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBeUndefined();
  });

  it('omits semantic furniture that collides with the door', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      doorTileOverride: 200,
      semantics: { '200': { class: 'furniture' } },
    });

    expect(tiles.furnitureTileId).toBeUndefined();
  });
  it('falls back when the mid-layer furniture majority equals the selected door', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      midLayer: [333, 333, 200],
      fallbackGround: 10,
      fallbackWall: 20,
      doorTileOverride: 333,
      semantics: { '200': { class: 'furniture' }, '333': { class: 'furniture' } },
    });

    expect(tiles.doorTileId).toBe(333);
    expect(tiles.furnitureTileId).toBe(200);
  });

  it('falls back when the mid-layer door majority equals the selected wall', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      midLayer: [80, 80, 77],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: 80,
      semantics: { '77': { class: 'door' }, '80': { class: 'door' } },
    });

    expect(tiles.wallTileId).toBe(80);
    expect(tiles.doorTileId).toBe(77);
  });

  it('falls back when the furniture override equals the ground tile', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      furnitureTileOverride: 1,
      semantics: { '200': { class: 'furniture' } },
    });

    expect(tiles.groundTileId).toBe(1);
    expect(tiles.furnitureTileId).toBe(200);
  });

  it('uses the ground tile when no nonzero wall fallback is available', () => {
    expect(
      resolveDungeonTileIds({
        fillTileId: 7,
        groundLayer: [],
        wallLayer: [],
        fallbackGround: 7,
        fallbackWall: 0,
      }),
    ).toEqual({ groundTileId: 7, wallTileId: 7 });
  });

  it('falls back to furniture semantics when its override is the wall tile', () => {
    const tiles = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      fallbackGround: 10,
      fallbackWall: 20,
      furnitureTileOverride: 5,
      semantics: {
        '5': { class: 'wall' },
        '200': { class: 'furniture' },
      },
    });

    expect(tiles.wallTileId).toBe(5);
    expect(tiles.furnitureTileId).toBe(200);
  });

  it('prefers brush fill for ground', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 99,
      groundLayer: [1, 1, 1],
      wallLayer: [5, 5],
      fallbackGround: 10,
      fallbackWall: 20,
    });
    expect(r.groundTileId).toBe(99);
    expect(r.wallTileId).toBe(5);
  });

  it('falls back when fill is zero', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 0,
      groundLayer: [3, 3, 0],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
    });
    expect(r.groundTileId).toBe(3);
    expect(r.wallTileId).toBe(20);
  });

  it('avoids wall === ground when fallback differs', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 7,
      groundLayer: [],
      wallLayer: [7, 7],
      fallbackGround: 7,
      fallbackWall: 20,
    });
    expect(r.groundTileId).toBe(7);
    expect(r.wallTileId).toBe(20);
  });

  it('wallTileOverride wins over layer majority', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [9, 9, 9],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: 42,
    });
    expect(r.groundTileId).toBe(1);
    expect(r.wallTileId).toBe(42);
  });

  it('prefers a wall-classed tile from semantics when wall layer is empty', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: {
        '50': { class: 'furniture' },
        '88': { class: 'wall' },
        '90': { class: 'door' },
      },
    });
    expect(r.wallTileId).toBe(88);
  });

  it('prefers majority wall-layer id only when it is already wall-classed', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [7, 7, 7, 88],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: {
        '7': { class: 'furniture' },
        '88': { class: 'wall' },
      },
    });
    // Majority 7 is furniture — skip to wall-classed 88 present on the layer.
    expect(r.wallTileId).toBe(88);
  });

  it('does not let semantics override an explicit wallTileOverride', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: 42,
      semantics: { '88': { class: 'wall' } },
    });
    expect(r.wallTileId).toBe(42);
  });

  it('resolves optional doorTileId from door-classed semantics', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: {
        '5': { class: 'wall' },
        '77': { class: 'door' },
        '80': { class: 'door' },
      },
    });
    expect(r.doorTileId).toBe(77);
  });

  it('excludes the ground tile when choosing a door from semantics', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: {
        '1': { class: 'door' },
        '5': { class: 'wall' },
        '77': { class: 'door' },
      },
    });

    expect(r.doorTileId).toBe(77);
  });

  it('prefers majority door/furniture on mid layer over first semantic id (WU-PROC-20)', () => {
    expect(
      majorityClassedTileId(
        [80, 80, 77, 0],
        { '77': { class: 'door' }, '80': { class: 'door' } },
        'door',
      ),
    ).toBe(80);

    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      midLayer: [200, 200, 201, 80, 80, 80],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: {
        '5': { class: 'wall' },
        '77': { class: 'door' },
        '80': { class: 'door' },
        '200': { class: 'furniture' },
        '201': { class: 'furniture' },
      },
    });
    // Mid majority door is 80 (not first semantic 77); furniture majority 200.
    expect(r.doorTileId).toBe(80);
    expect(r.furnitureTileId).toBe(200);
  });

  it('doorTileOverride still wins over mid-layer majority', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      midLayer: [80, 80, 80],
      fallbackGround: 10,
      fallbackWall: 20,
      doorTileOverride: 77,
      semantics: {
        '5': { class: 'wall' },
        '77': { class: 'door' },
        '80': { class: 'door' },
      },
    });
    expect(r.doorTileId).toBe(77);
  });

  it('omits doorTileId when no door-classed semantics exist', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
    });
    expect(r.doorTileId).toBeUndefined();
    expect(r.furnitureTileId).toBeUndefined();
  });

  it('resolves optional furnitureTileId from furniture-classed semantics', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: {
        '5': { class: 'wall' },
        '77': { class: 'door' },
        '200': { class: 'furniture' },
        '201': { class: 'furniture' },
      },
    });
    expect(r.furnitureTileId).toBe(200);
    expect(r.doorTileId).toBe(77);
  });

  it('does not select the ground tile as furniture', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      midLayer: [1, 1, 200],
      fallbackGround: 10,
      fallbackWall: 20,
      semantics: {
        '1': { class: 'furniture' },
        '5': { class: 'wall' },
        '200': { class: 'furniture' },
      },
    });
    expect(r.furnitureTileId).toBe(200);
  });

  it('furnitureTileOverride wins and skips collisions with ground/wall/door', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      fallbackGround: 10,
      fallbackWall: 20,
      furnitureTileOverride: 333,
      semantics: {
        '5': { class: 'wall' },
        '77': { class: 'door' },
        '200': { class: 'furniture' },
      },
    });
    expect(r.furnitureTileId).toBe(333);
    const collided = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      fallbackGround: 10,
      fallbackWall: 20,
      doorTileOverride: 77,
      furnitureTileOverride: 77,
      semantics: { '5': { class: 'wall' }, '200': { class: 'furniture' } },
    });
    // Override collides with door → fall back to furniture semantics.
    expect(collided.furnitureTileId).toBe(200);
  });

  it('doorTileOverride wins over door-classed semantics', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      fallbackGround: 10,
      fallbackWall: 20,
      doorTileOverride: 501,
      semantics: {
        '5': { class: 'wall' },
        '77': { class: 'door' },
      },
    });
    expect(r.doorTileId).toBe(501);
  });

  it('doorTileOverride zero falls through to door semantics', () => {
    const r = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [],
      fallbackGround: 10,
      fallbackWall: 20,
      doorTileOverride: 0,
      semantics: { '77': { class: 'door' } },
    });
    expect(r.doorTileId).toBe(77);
  });

  it('rejects doorTileOverride equal to ground or wall', () => {
    const sameAsGround = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      fallbackGround: 10,
      fallbackWall: 20,
      doorTileOverride: 1,
      semantics: { '5': { class: 'wall' }, '77': { class: 'door' } },
    });
    // Invalid override ignored → semantic door.
    expect(sameAsGround.doorTileId).toBe(77);

    const sameAsWall = resolveDungeonTileIds({
      fillTileId: 1,
      groundLayer: [1],
      wallLayer: [5],
      fallbackGround: 10,
      fallbackWall: 20,
      wallTileOverride: 9,
      doorTileOverride: 9,
    });
    expect(sameAsWall.doorTileId).toBeUndefined();
  });
});
