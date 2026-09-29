import { describe, expect, it } from 'vitest';
import { orderMapInfosByTree, parseMapInfos } from '../src/parse-map-infos.js';

describe('parseMapInfos', () => {
  it('identifies MapInfos.json when the top-level value is not an array', () => {
    expect(() => parseMapInfos({})).toThrow(new Error('Invalid MapInfos.json: expected an array.'));
  });

  it('includes only the malformed map info in the required-field error', () => {
    const valid = { id: 1, name: 'Town', parentId: 0, order: 1 };
    const malformed = { id: 23, name: false, parentId: 0, order: 2 };

    expect(() => parseMapInfos([null, valid, malformed])).toThrow(
      new Error('Invalid MapInfos.json entry: {"id":23,"name":false,"parentId":0,"order":2}'),
    );
  });

  it('reports the object type error for a primitive map info entry', () => {
    expect(() => parseMapInfos([7])).toThrow(
      new Error('Invalid MapInfos.json entry: expected an object, got number.'),
    );
  });

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

  it('rejects a nonnumeric parent id even when every other field is valid', () => {
    expect(() => parseMapInfos([{ id: 1, name: 'Town', parentId: '0', order: 1 }])).toThrow(
      /Invalid MapInfos.json entry/,
    );
  });

  it('rejects a map info with a nonnumeric sidebar order', () => {
    expect(() => parseMapInfos([{ id: 1, name: 'Town', parentId: 0, order: '1' }])).toThrow(
      /Invalid MapInfos.json entry/,
    );
  });

  it('skips undefined slots in a sparse map info list', () => {
    expect(parseMapInfos([undefined, { id: 1, name: 'Town', parentId: 0, order: 1 }])).toEqual([
      { id: 1, name: 'Town', parentId: 0, order: 1 },
    ]);
  });
});

describe('orderMapInfosByTree', () => {
  it('keeps sidebar order ahead of a conflicting map ID', () => {
    const infos = orderMapInfosByTree([
      { id: 9, name: 'First root', parentId: 0, order: 0 },
      { id: 1, name: 'Second root', parentId: 0, order: 1 },
    ]);

    expect(infos.map((info) => info.id)).toEqual([9, 1]);
  });

  it('visits a root child before the next root', () => {
    const infos = orderMapInfosByTree([
      { id: 10, name: 'First root', parentId: 0, order: 0 },
      { id: 11, name: 'Child', parentId: 10, order: 0 },
      { id: 12, name: 'Second root', parentId: 0, order: 1 },
    ]);

    expect(infos.map((info) => info.id)).toEqual([10, 11, 12]);
  });

  it('keeps a reachable cycle out of the unvisited map fallback', () => {
    const infos = orderMapInfosByTree([
      { id: 0, name: 'Root cycle', parentId: 0, order: 0 },
      { id: 1, name: 'Child', parentId: 0, order: 1 },
    ]);

    expect(infos.map((info) => info.id)).toEqual([0, 1]);
  });

  it('lists roots by order, then each parent before its children', () => {
    const infos = orderMapInfosByTree([
      { id: 10, name: 'Ten', parentId: 0, order: 1 },
      { id: 11, name: 'Eleven', parentId: 10, order: 0 },
      { id: 12, name: 'Twelve', parentId: 0, order: 0 },
    ]);

    expect(infos.map((info) => info.id)).toEqual([12, 10, 11]);
  });

  it('orders equal-order siblings by ascending id', () => {
    const infos = orderMapInfosByTree([
      { id: 10, name: 'Parent', parentId: 0, order: 0 },
      { id: 12, name: 'Child 12', parentId: 10, order: 1 },
      { id: 11, name: 'Child 11', parentId: 10, order: 1 },
    ]);

    expect(infos.map((info) => info.id)).toEqual([10, 11, 12]);
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
