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
  it('rejects a fractional height even when the total layer length is integral', () => {
    const json = { ...makeMapJson(1, 1, () => 0), height: 1.5, data: new Array(9).fill(0) };

    expect(() => parseMap(json)).toThrow(/positive safe integers/);
  });

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

  it('mutation pin: rejects extra cells after all six layers', () => {
    const json = makeMapJson(1, 1, () => 0);
    json.data.push(0);
    expect(() => parseMap(json)).toThrow(/data.*length/);
  });

  it('mutation pin: rejects a zero-width map', () => {
    expect(() => parseMap(makeMapJson(0, 1, () => 0))).toThrow(/positive safe integers/);
  });

  it('rejects a zero-height map', () => {
    expect(() => parseMap(makeMapJson(1, 0, () => 0))).toThrow(/positive safe integers/);
  });

  it('mutation pin: rejects dimensions whose combined layer count is unsafe', () => {
    expect(() =>
      parseMap({ width: Number.MAX_SAFE_INTEGER, height: 1, tilesetId: 1, data: [] }),
    ).toThrow(/must be a safe integer/);
  });

  it.each([
    ['fractional width', { width: 1.5, height: 1, data: [0, 0, 0, 0, 0, 0] }],
    ['negative height', { width: 1, height: -1, data: [] }],
    ['infinite width', { width: Infinity, height: 1, data: [] }],
    ['fractional cell', { width: 1, height: 1, data: [0, 0, 0, 0, 0, 1.5] }],
    ['negative cell', { width: 1, height: 1, data: [0, 0, 0, 0, 0, -1] }],
    ['non-finite cell', { width: 1, height: 1, data: [0, 0, 0, 0, 0, NaN] }],
  ])('rejects malformed grid numbers: %s', (_caseName, values) => {
    expect(() => parseMap({ ...values, tilesetId: 1 })).toThrow(/Invalid Map JSON/);
  });

  it('accepts non-negative safe integer dimensions and cells', () => {
    expect(() => parseMap(makeMapJson(1, 1, () => 0))).not.toThrow();
  });

  it('rejects a tile value above the safe integer limit', () => {
    expect(() => parseMap(makeMapJson(1, 1, () => Number.MAX_SAFE_INTEGER + 1))).toThrow(
      /non-negative safe integers/,
    );
  });

  it('rejects a string tileset id instead of accepting a broken tileset reference', () => {
    const json = { ...makeMapJson(1, 1, () => 0), tilesetId: '1' };

    expect(() => parseMap(json)).toThrow(/"tilesetId" must be a number/);
  });

  it('throws on non-object input', () => {
    expect(() => parseMap(null)).toThrow();
    expect(() => parseMap('nope')).toThrow();
  });

  it('passes events through, keeping objects and null', () => {
    const event = { id: 7, name: 'Elder', x: 1, y: 0, pages: [] };
    const json = { ...makeMapJson(1, 1, () => 0), events: [null, event, 'drop-me', 2] };
    const map = parseMap(json, 7);

    expect(map.events).toEqual([null, event]);
  });

  it('drops undefined event slots while preserving null and object slots', () => {
    const event = { id: 7, name: 'Elder', x: 0, y: 0, pages: [] };
    const json = { ...makeMapJson(1, 1, () => 0), events: [undefined, null, event] };

    expect(parseMap(json).events).toEqual([null, event]);
  });

  it('leaves events undefined when the map JSON has no events array', () => {
    const map = parseMap(makeMapJson(1, 1, () => 0));
    expect(map.events).toBeUndefined();
  });

  it('defaults a missing scroll type to no scrolling', () => {
    const { scrollType: _scrollType, ...json } = makeMapJson(1, 1, () => 0);
    expect(parseMap(json).scrollType).toBe(0);
  });

  it('preserves a valid nonzero scroll type', () => {
    expect(parseMap({ ...makeMapJson(1, 1, () => 0), scrollType: 2 }).scrollType).toBe(2);
  });
});
