import { describe, expect, it } from 'vitest';
import { parseMapInfos } from '../src/parse-map-infos.js';

describe('parseMapInfos', () => {
  it('parses a well-formed MapInfos.json array, skipping the null placeholder at index 0', () => {
    const infos = parseMapInfos([
      null,
      { id: 1, name: 'Town', parentId: 0, order: 1, expanded: true, scrollX: 0, scrollY: 0 },
      { id: 2, name: 'Dungeon', parentId: 1, order: 2, expanded: false, scrollX: 0, scrollY: 0 },
    ]);

    expect(infos).toEqual([
      { id: 1, name: 'Town', parentId: 0, order: 1 },
      { id: 2, name: 'Dungeon', parentId: 1, order: 2 },
    ]);
  });

  it('throws on non-array input', () => {
    expect(() => parseMapInfos({})).toThrow();
  });

  it('throws when a required field is missing or has the wrong type', () => {
    expect(() => parseMapInfos([{ id: '1', name: 'Town', parentId: 0, order: 1 }])).toThrow();
  });
});
