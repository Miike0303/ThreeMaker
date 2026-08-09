import { describe, expect, it } from 'vitest';
import {
  majorityClassedTileId,
  majorityNonZeroTileId,
  resolveDungeonTileIds,
} from '../src/procgen/tile-pick.js';

describe('majorityNonZeroTileId', () => {
  it('returns undefined for empty/zero layers', () => {
    expect(majorityNonZeroTileId([])).toBeUndefined();
    expect(majorityNonZeroTileId([0, 0, 0])).toBeUndefined();
  });

  it('picks the most frequent non-zero id', () => {
    expect(majorityNonZeroTileId([1, 2, 2, 0, 2, 1])).toBe(2);
  });
});

describe('resolveDungeonTileIds', () => {
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
