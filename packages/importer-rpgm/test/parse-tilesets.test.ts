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

  it('parses multiple tilesets', () => {
    const tilesets = parseTilesets([
      null,
      { id: 1, name: 'One', flags: makeFlags(), tilesetNames: new Array(9).fill('') },
      { id: 2, name: 'Two', flags: makeFlags(), tilesetNames: new Array(9).fill('') },
    ]);

    expect(tilesets.map((tileset) => tileset.id)).toEqual([1, 2]);
  });

  it('throws on non-array input', () => {
    expect(() => parseTilesets({})).toThrow();
  });

  it('throws when flags is missing', () => {
    expect(() =>
      parseTilesets([{ id: 1, name: 'x', tilesetNames: new Array(9).fill('') }]),
    ).toThrow();
  });

  it('throws when a tileset id is a string', () => {
    expect(() =>
      parseTilesets([
        { id: '1', name: 'One', flags: makeFlags(), tilesetNames: new Array(9).fill('') },
      ]),
    ).toThrow();
  });

  it('throws when tilesetNames does not have exactly 9 entries', () => {
    expect(() =>
      parseTilesets([{ id: 1, name: 'x', flags: makeFlags(), tilesetNames: ['a'] }]),
    ).toThrow();
  });

  it('throws when flags contain a non-finite number', () => {
    const json = JSON.parse(
      '{"id":1,"name":"x","flags":[0,1e400],"tilesetNames":["","","","","","","","",""]}',
    );

    expect(() => parseTilesets([json])).toThrow(/flags/);
  });

  it('throws when flags contain a negative integer', () => {
    expect(() =>
      parseTilesets([{ id: 1, name: 'x', flags: [0, -1], tilesetNames: new Array(9).fill('') }]),
    ).toThrow(/flags/);
  });

  it('throws when flags contain a fractional number', () => {
    expect(() =>
      parseTilesets([{ id: 1, name: 'x', flags: [0, 1.5], tilesetNames: new Array(9).fill('') }]),
    ).toThrow(/flags/);
  });

  it('throws when tileset ids are duplicated', () => {
    expect(() =>
      parseTilesets([
        { id: 1, name: 'one', flags: makeFlags(), tilesetNames: new Array(9).fill('') },
        { id: 1, name: 'another one', flags: makeFlags(), tilesetNames: new Array(9).fill('') },
      ]),
    ).toThrow(/duplicate tileset id 1/);
  });

  it('skips undefined slots in a sparse tileset list', () => {
    const tilesets = parseTilesets([
      undefined,
      { id: 1, name: 'Town', flags: makeFlags(), tilesetNames: new Array(9).fill('') },
    ]);
    expect(tilesets.map((tileset) => tileset.id)).toEqual([1]);
  });
});
