import { describe, expect, it } from 'vitest';
import { parseTilesets } from '../src/parse-tilesets.js';

function makeFlags(): number[] {
  return new Array(8192).fill(0);
}

describe('parseTilesets', () => {
  it('maps tilesetNames in A1-A5, B-E order', () => {
    const tilesets = parseTilesets([
      null,
      {
        id: 1,
        name: 'Overworld',
        mode: 0,
        flags: makeFlags(),
        tilesetNames: ['World_A1', 'World_A2', '', '', '', 'World_B', 'World_C', '', ''],
      },
    ]);

    expect(tilesets).toHaveLength(1);
    expect(tilesets[0]?.sheetNames).toEqual({
      A1: 'World_A1',
      A2: 'World_A2',
      A3: '',
      A4: '',
      A5: '',
      B: 'World_B',
      C: 'World_C',
      D: '',
      E: '',
    });
    expect(tilesets[0]?.flags).toHaveLength(8192);
  });

  it('throws on non-array input', () => {
    expect(() => parseTilesets({})).toThrow();
  });

  it('throws when flags is missing', () => {
    expect(() =>
      parseTilesets([{ id: 1, name: 'x', tilesetNames: new Array(9).fill('') }]),
    ).toThrow();
  });

  it('throws when tilesetNames does not have exactly 9 entries', () => {
    expect(() =>
      parseTilesets([{ id: 1, name: 'x', flags: makeFlags(), tilesetNames: ['a'] }]),
    ).toThrow();
  });
});
