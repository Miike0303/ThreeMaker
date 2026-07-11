import { describe, expect, it } from 'vitest';
import {
  generateSyntheticMap,
  ROSELIAM_DUNGEON_GROUND_TILE_ID,
  ROSELIAM_DUNGEON_WALL_TILE_ID,
} from '../src/dev/synthetic-map.js';

describe('generateSyntheticMap', () => {
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

  it('is deterministic: the same seed yields the same map, different seeds differ', () => {
    const a = generateSyntheticMap({ width: 64, height: 64, seed: 42 });
    const b = generateSyntheticMap({ width: 64, height: 64, seed: 42 });
    const c = generateSyntheticMap({ width: 64, height: 64, seed: 43 });

    expect(a.layers.tileLayers).toEqual(b.layers.tileLayers);
    expect(a.layers.tileLayers[0]).not.toEqual(c.layers.tileLayers[0]);
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
});
