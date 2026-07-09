import { describe, expect, it } from 'vitest';
import { parseMap } from '../src/parse-map.js';

function makeMapJson(width: number, height: number, fill: (z: number, i: number) => number) {
  const size = width * height;
  const data: number[] = [];
  for (let z = 0; z < 6; z++) {
    for (let i = 0; i < size; i++) {
      data.push(fill(z, i));
    }
  }
  return { width, height, tilesetId: 1, scrollType: 0, displayName: 'Test Map', data };
}

describe('parseMap', () => {
  it('parses width, height, tilesetId, and displayName', () => {
    const json = makeMapJson(2, 2, () => 0);
    const map = parseMap(json, 42);

    expect(map.id).toBe(42);
    expect(map.width).toBe(2);
    expect(map.height).toBe(2);
    expect(map.tilesetId).toBe(1);
    expect(map.displayName).toBe('Test Map');
  });

  it('splits the flat 6-layer array into 4 tile layers + shadows + regions', () => {
    const json = makeMapJson(2, 2, (z) => (z + 1) * 100);
    const map = parseMap(json);

    expect(map.layers.tileLayers[0]).toEqual([100, 100, 100, 100]);
    expect(map.layers.tileLayers[1]).toEqual([200, 200, 200, 200]);
    expect(map.layers.tileLayers[2]).toEqual([300, 300, 300, 300]);
    expect(map.layers.tileLayers[3]).toEqual([400, 400, 400, 400]);
    expect(map.layers.shadows).toEqual([500, 500, 500, 500]);
    expect(map.layers.regions).toEqual([600, 600, 600, 600]);
  });

  it('defaults id to null when not provided', () => {
    const map = parseMap(makeMapJson(1, 1, () => 0));
    expect(map.id).toBeNull();
  });

  it('throws when data length does not match width*height*6', () => {
    const json = makeMapJson(2, 2, () => 0);
    (json.data as number[]).pop();
    expect(() => parseMap(json)).toThrow(/width\*height\*6/);
  });

  it('throws on non-object input', () => {
    expect(() => parseMap(null)).toThrow();
    expect(() => parseMap('nope')).toThrow();
  });
});
