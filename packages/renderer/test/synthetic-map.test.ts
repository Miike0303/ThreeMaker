import { describe, expect, it } from 'vitest';
import {
  generateSyntheticMap,
  ROSELIAM_DUNGEON_GROUND_TILE_ID,
  ROSELIAM_DUNGEON_WALL_TILE_ID,
} from '../src/dev/synthetic-map.js';

describe('generateSyntheticMap', () => {
  it('centers the spawn clearing horizontally on a rectangular map', () => {
    const map = generateSyntheticMap({
      width: 9,
      height: 5,
      wallDensity: 1,
      decorDensity: 0,
      clearRadius: 1,
    });

    expect(map.layers.tileLayers[0][1 * 9 + 4]).toBe(ROSELIAM_DUNGEON_GROUND_TILE_ID);
  });

  it('centers the walkable corridor on the height of a rectangular map', () => {
    const map = generateSyntheticMap({
      width: 9,
      height: 5,
      wallDensity: 1,
      decorDensity: 0,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[0].slice(2 * 9, 3 * 9)).toEqual(
      Array(9).fill(ROSELIAM_DUNGEON_GROUND_TILE_ID),
    );
  });

  it('populates the far east column of a wide map', () => {
    const map = generateSyntheticMap({
      width: 9,
      height: 5,
      wallDensity: 1,
      decorDensity: 0,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[0][8]).toBe(ROSELIAM_DUNGEON_WALL_TILE_ID);
  });

  it('paints wall shadows in the far east column of a wide map', () => {
    const map = generateSyntheticMap({
      width: 16,
      height: 8,
      seed: 1,
      wallDensity: 0.5,
      decorDensity: 0,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[0][14]).toBe(ROSELIAM_DUNGEON_WALL_TILE_ID);
    expect(map.layers.tileLayers[0][15]).toBe(ROSELIAM_DUNGEON_GROUND_TILE_ID);
    expect(map.layers.shadows[15]).toBe(5);
  });

  it('paints wall shadows in the last row of a tall map', () => {
    const map = generateSyntheticMap({
      width: 8,
      height: 16,
      seed: 1,
      wallDensity: 0.5,
      decorDensity: 0,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[0][15 * 8]).toBe(ROSELIAM_DUNGEON_WALL_TILE_ID);
    expect(map.layers.tileLayers[0][15 * 8 + 1]).toBe(ROSELIAM_DUNGEON_GROUND_TILE_ID);
    expect(map.layers.shadows[15 * 8 + 1]).toBe(5);
  });

  it('leaves synthetic maps without a source map id', () => {
    expect(generateSyntheticMap({ width: 3, height: 5 }).id).toBeNull();
  });

  it('names a rectangular map with its width before its height', () => {
    expect(generateSyntheticMap({ width: 3, height: 5 }).displayName).toBe('Synthetic 3x5');
  });

  it('places a wall when the seeded first roll is one step below the density', () => {
    const density = 1015568749 / 2 ** 32;
    const map = generateSyntheticMap({
      width: 5,
      height: 5,
      seed: 1,
      wallDensity: density,
      decorDensity: 0,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[0][0]).toBe(ROSELIAM_DUNGEON_WALL_TILE_ID);
  });

  it('rejects a zero map height before allocating tile layers', () => {
    expect(() => generateSyntheticMap({ width: 3, height: 0 })).toThrow(/height/);
  });

  it('reports a negative map width as a dimension error', () => {
    expect(() => generateSyntheticMap({ width: -1, height: 2 })).toThrow(
      'width must be a positive integer, got -1.',
    );
  });

  it('keeps tile layer 1 empty when decorations are present', () => {
    const map = generateSyntheticMap({
      width: 3,
      height: 3,
      wallDensity: 0,
      decorDensity: 1,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[2]).toContain(69);
    expect(map.layers.tileLayers[1]).toEqual(Array(9).fill(0));
  });

  it('keeps tile layer 3 empty when decorations are present', () => {
    const map = generateSyntheticMap({
      width: 3,
      height: 3,
      wallDensity: 0,
      decorDensity: 1,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[2]).toContain(69);
    expect(map.layers.tileLayers[3]).toEqual(Array(9).fill(0));
  });

  it('keeps region IDs empty when decorations are present', () => {
    const map = generateSyntheticMap({
      width: 3,
      height: 3,
      wallDensity: 0,
      decorDensity: 1,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[2]).toContain(69);
    expect(map.layers.regions).toEqual(Array(9).fill(0));
  });

  it('keeps a wall roll equal to the density on the floor', () => {
    const firstRoll = 1015568748 / 2 ** 32;
    const map = generateSyntheticMap({
      width: 5,
      height: 5,
      seed: 1,
      wallDensity: firstRoll,
      decorDensity: 0,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[0][0]).toBe(3968);
  });

  it('leaves a floor tile undecorated when its decor roll equals the density', () => {
    const firstDecorRoll = 1586005467 / 2 ** 32;
    const map = generateSyntheticMap({
      width: 5,
      height: 5,
      seed: 1,
      wallDensity: 0,
      decorDensity: firstDecorRoll,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[2][0]).toBe(0);
  });

  it('keeps the seeded wall layout stable at the first tile', () => {
    const map = generateSyntheticMap({
      width: 5,
      height: 5,
      seed: 1,
      wallDensity: 0.5,
      decorDensity: 0,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[0][0]).toBe(6335);
  });

  it('uses the Dungeon tileset by default', () => {
    expect(generateSyntheticMap({ width: 1, height: 1 }).tilesetId).toBe(4);
  });

  it('uses the Dungeon decoration tile on decorated cells', () => {
    const map = generateSyntheticMap({
      width: 3,
      height: 3,
      wallDensity: 0,
      decorDensity: 1,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[2][0]).toBe(69);
  });

  it('keeps synthetic maps non-looping', () => {
    expect(generateSyntheticMap({ width: 1, height: 1 }).scrollType).toBe(0);
  });

  it('uses the Dungeon wall tile for a guaranteed wall', () => {
    const map = generateSyntheticMap({ width: 3, height: 3, wallDensity: 1, clearRadius: 0 });

    expect(map.layers.tileLayers[0][0]).toBe(6335);
  });

  it('uses the Dungeon ground tile in the spawn clearing', () => {
    const map = generateSyntheticMap({ width: 1, height: 1 });

    expect(map.layers.tileLayers[0][0]).toBe(3968);
  });

  it('pins the default decoration density', () => {
    const defaultMap = generateSyntheticMap({ width: 128, height: 128, seed: 19 });
    const explicitMap = generateSyntheticMap({
      width: 128,
      height: 128,
      seed: 19,
      decorDensity: 0.02,
    });

    expect(defaultMap.layers.tileLayers[2]).toEqual(explicitMap.layers.tileLayers[2]);
  });

  it('pins the default clear radius at three tiles', () => {
    const map = generateSyntheticMap({ width: 9, height: 9, wallDensity: 1 });

    expect(map.layers.tileLayers[0][1 * 9 + 1]).toBe(ROSELIAM_DUNGEON_GROUND_TILE_ID);
  });

  it('pins zero shadow on a wall east of another wall', () => {
    const map = generateSyntheticMap({
      width: 5,
      height: 5,
      wallDensity: 1,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[0][0]).toBe(ROSELIAM_DUNGEON_WALL_TILE_ID);
    expect(map.layers.tileLayers[0][1]).toBe(ROSELIAM_DUNGEON_WALL_TILE_ID);
    expect(map.layers.shadows[1]).toBe(0);
  });

  it('produces an RpgmMap-shaped map with the requested dimensions and 6 decoded layers', () => {
    const map = generateSyntheticMap({ width: 32, height: 24, seed: 1 });

    expect(map.width).toBe(32);
    expect(map.height).toBe(24);
    expect(map.layers.tileLayers).toHaveLength(4);
    for (const layer of map.layers.tileLayers) {
      expect(layer).toHaveLength(32 * 24);
    }
    expect(map.layers.shadows).toHaveLength(32 * 24);
    expect(map.layers.regions).toHaveLength(32 * 24);
  });

  it('leaves tile layer 1 blank even when the ground contains walls', () => {
    const map = generateSyntheticMap({ width: 3, height: 3, wallDensity: 1, clearRadius: 0 });

    expect(map.layers.tileLayers[1]).toEqual(Array(9).fill(0));
  });

  it('leaves tile layer 3 blank even when the ground contains walls', () => {
    const map = generateSyntheticMap({ width: 3, height: 3, wallDensity: 1, clearRadius: 0 });

    expect(map.layers.tileLayers[3]).toEqual(Array(9).fill(0));
  });

  it('leaves region IDs blank even when the ground contains walls', () => {
    const map = generateSyntheticMap({ width: 3, height: 3, wallDensity: 1, clearRadius: 0 });

    expect(map.layers.regions).toEqual(Array(9).fill(0));
  });

  it('is deterministic: the same seed yields the same map, different seeds differ', () => {
    const a = generateSyntheticMap({ width: 64, height: 64, seed: 42 });
    const b = generateSyntheticMap({ width: 64, height: 64, seed: 42 });
    const c = generateSyntheticMap({ width: 64, height: 64, seed: 43 });

    expect(a.layers.tileLayers).toEqual(b.layers.tileLayers);
    expect(a.layers.tileLayers[0]).not.toEqual(c.layers.tileLayers[0]);
  });

  it('uses seed 1 when no seed is provided', () => {
    const defaultSeed = generateSyntheticMap({ width: 40, height: 40 });
    const explicitSeed = generateSyntheticMap({ width: 40, height: 40, seed: 1 });

    expect(defaultSeed.layers.tileLayers).toEqual(explicitSeed.layers.tileLayers);
  });

  it('uses the documented default wall density', () => {
    const defaultMap = generateSyntheticMap({ width: 64, height: 64, seed: 19 });
    const explicitMap = generateSyntheticMap({
      width: 64,
      height: 64,
      seed: 19,
      wallDensity: 0.04,
    });

    expect(defaultMap.layers.tileLayers[0]).toEqual(explicitMap.layers.tileLayers[0]);
  });

  it('preserves an explicitly selected tileset id of zero', () => {
    expect(generateSyntheticMap({ width: 1, height: 1, tilesetId: 0 }).tilesetId).toBe(0);
  });

  it('fills layer 0 with the ground autotile and scatters some walls', () => {
    const map = generateSyntheticMap({ width: 64, height: 64, seed: 7 });

    const layer0 = map.layers.tileLayers[0];
    const groundCount = layer0.filter((id) => id === ROSELIAM_DUNGEON_GROUND_TILE_ID).length;
    const wallCount = layer0.filter((id) => id === ROSELIAM_DUNGEON_WALL_TILE_ID).length;

    expect(groundCount + wallCount).toBe(64 * 64); // no holes
    expect(groundCount).toBeGreaterThan(wallCount); // mostly walkable floor
    expect(wallCount).toBeGreaterThan(0); // but not empty
  });

  it('keeps a clear spawn area around the map center', () => {
    const map = generateSyntheticMap({ width: 128, height: 128, seed: 3, clearRadius: 3 });

    const cx = 64;
    const cy = 64;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const id = map.layers.tileLayers[0][(cy + dy) * 128 + (cx + dx)];
        expect(id).toBe(ROSELIAM_DUNGEON_GROUND_TILE_ID);
      }
    }
  });

  it('keeps the whole spawn row clear as a walkable east-west corridor', () => {
    const map = generateSyntheticMap({ width: 256, height: 256, seed: 11 });

    const centerY = 128;
    for (let x = 0; x < 256; x++) {
      expect(map.layers.tileLayers[0][centerY * 256 + x]).toBe(ROSELIAM_DUNGEON_GROUND_TILE_ID);
      expect(map.layers.tileLayers[2][centerY * 256 + x]).toBe(0);
    }
  });

  it('rejects non-positive dimensions', () => {
    expect(() => generateSyntheticMap({ width: 0, height: 10 })).toThrow(/width/);
    expect(() => generateSyntheticMap({ width: 10, height: -1 })).toThrow(/height/);
  });

  it('rejects a fractional map width before allocating tile layers', () => {
    expect(() => generateSyntheticMap({ width: 2.5, height: 4 })).toThrow(/width/);
  });

  it('rejects a fractional map height before allocating tile layers', () => {
    expect(() => generateSyntheticMap({ width: 4, height: 2.5 })).toThrow(/height/);
  });

  it('honors a zero clear radius outside the spawn row', () => {
    const map = generateSyntheticMap({ width: 9, height: 9, wallDensity: 1, clearRadius: 0 });

    expect(map.layers.tileLayers[0][3 * 9 + 4]).toBe(ROSELIAM_DUNGEON_WALL_TILE_ID);
    expect(map.layers.tileLayers[0][4 * 9 + 4]).toBe(ROSELIAM_DUNGEON_GROUND_TILE_ID);
  });

  it('does not place decorations on wall tiles', () => {
    const map = generateSyntheticMap({
      width: 5,
      height: 5,
      wallDensity: 1,
      decorDensity: 1,
      clearRadius: 0,
    });

    expect(map.layers.tileLayers[0][0]).toBe(ROSELIAM_DUNGEON_WALL_TILE_ID);
    expect(map.layers.tileLayers[2][0]).toBe(0);
  });

  it('paints the west half of ground immediately east of a wall', () => {
    const map = generateSyntheticMap({
      width: 16,
      height: 16,
      seed: 1,
      wallDensity: 0.5,
      decorDensity: 0,
      clearRadius: 0,
    });
    const ground = map.layers.tileLayers[0];
    const eastOfWall = ground.findIndex(
      (tileId, index) =>
        index % map.width > 0 &&
        tileId === ROSELIAM_DUNGEON_GROUND_TILE_ID &&
        ground[index - 1] === ROSELIAM_DUNGEON_WALL_TILE_ID,
    );

    expect(eastOfWall).toBeGreaterThanOrEqual(0);
    expect(map.layers.shadows[eastOfWall]).toBe(5);
  });

  it('does not carry a wall shadow across a row boundary', () => {
    const map = generateSyntheticMap({
      width: 16,
      height: 16,
      seed: 1,
      wallDensity: 0.5,
      decorDensity: 0,
      clearRadius: 0,
    });
    const ground = map.layers.tileLayers[0];
    const rowStartsAfterWall = Array.from(
      { length: map.height - 1 },
      (_, row) => (row + 1) * 16,
    ).filter(
      (index) =>
        ground[index - 1] === ROSELIAM_DUNGEON_WALL_TILE_ID &&
        ground[index] === ROSELIAM_DUNGEON_GROUND_TILE_ID,
    );

    expect(rowStartsAfterWall.length).toBeGreaterThan(0);
    for (const index of rowStartsAfterWall) expect(map.layers.shadows[index]).toBe(0);
  });

  it('paints wall shadows on the last row of a rectangular map', () => {
    const map = generateSyntheticMap({
      width: 16,
      height: 8,
      seed: 1,
      wallDensity: 0.5,
      decorDensity: 0,
      clearRadius: 0,
    });
    const rowStart = (map.height - 1) * map.width;
    const eastOfWall = Array.from(
      { length: map.width - 1 },
      (_, offset) => rowStart + offset + 1,
    ).find(
      (index) =>
        map.layers.tileLayers[0][index - 1] === ROSELIAM_DUNGEON_WALL_TILE_ID &&
        map.layers.tileLayers[0][index] === ROSELIAM_DUNGEON_GROUND_TILE_ID,
    );

    if (eastOfWall === undefined)
      throw new Error('Expected ground east of a wall on the last row.');
    expect(map.layers.shadows[eastOfWall]).toBe(5);
  });
});
