import type { SemanticOverrides } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  assignSemanticClass,
  getSemanticClass,
  resolveTouchedTileIds,
} from '../src/semantic-store.js';

describe('resolveTouchedTileIds', () => {
  it('collects every distinct non-empty tile id under the given cells', () => {
    const layer = [7, 0, 7, 9];
    const ids = resolveTouchedTileIds(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      layer,
      4,
    );
    expect([...ids].sort()).toEqual([7, 9]);
  });

  it('excludes empty (id 0) cells', () => {
    const layer = [0, 0];
    const ids = resolveTouchedTileIds(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      layer,
      2,
    );
    expect(ids.size).toBe(0);
  });
});

describe('assignSemanticClass / getSemanticClass', () => {
  it('assigns a class to every touched tile id, without altering unrelated ids', () => {
    const semantics: SemanticOverrides = { '5': { class: 'wall' } };
    const next = assignSemanticClass(semantics, new Set([7, 9]), 'door');

    expect(getSemanticClass(next, 7)).toBe('door');
    expect(getSemanticClass(next, 9)).toBe('door');
    expect(getSemanticClass(next, 5)).toBe('wall'); // untouched entry preserved
  });

  it('defaults an id with no override to "none"', () => {
    expect(getSemanticClass({}, 42)).toBe('none');
  });

  it('is a no-op for an empty tile-id set', () => {
    const semantics: SemanticOverrides = { '1': { class: 'furniture' } };
    expect(assignSemanticClass(semantics, new Set(), 'door')).toBe(semantics);
  });

  it('overwrites a previous class assignment for the same tile id', () => {
    let semantics: SemanticOverrides = {};
    semantics = assignSemanticClass(semantics, new Set([1]), 'wall');
    semantics = assignSemanticClass(semantics, new Set([1]), 'window');
    expect(getSemanticClass(semantics, 1)).toBe('window');
  });
});
