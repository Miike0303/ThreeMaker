import { describe, expect, it } from 'vitest';
import { orderMapInfosByTree, parseMapInfos } from '../src/parse-map-infos.js';

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

describe('orderMapInfosByTree', () => {
  it('lists roots by order, then each parent before its children', () => {
    const infos = orderMapInfosByTree([
      { id: 10, name: 'Ten', parentId: 0, order: 1 },
      { id: 11, name: 'Eleven', parentId: 10, order: 0 },
      { id: 12, name: 'Twelve', parentId: 0, order: 0 },
    ]);

    expect(infos.map((info) => info.id)).toEqual([12, 10, 11]);
  });

  it('appends an orphan and a 2-cycle by id', () => {
    const infos = orderMapInfosByTree([
      { id: 10, name: 'Ten', parentId: 0, order: 1 },
      { id: 11, name: 'Eleven', parentId: 10, order: 0 },
      { id: 12, name: 'Twelve', parentId: 0, order: 0 },
      { id: 21, name: 'Orphan', parentId: 99, order: 0 },
      { id: 22, name: 'CycleB', parentId: 20, order: 0 },
      { id: 20, name: 'CycleA', parentId: 22, order: 1 },
    ]);

    expect(infos.map((info) => info.id)).toEqual([12, 10, 11, 20, 21, 22]);
  });
});
