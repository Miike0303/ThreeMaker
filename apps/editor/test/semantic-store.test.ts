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

  it('assigns the ramp class to every touched tile id (spec: "Assign ramp class")', () => {
    const semantics = assignSemanticClass({}, new Set([42]), 'ramp');
    expect(getSemanticClass(semantics, 42)).toBe('ramp');
  });

  it("preserves an unrelated ramp entry's rampDirection override across a save/load roundtrip (spec: Save/load roundtrip)", () => {
    const semantics: SemanticOverrides = {
      '5': { class: 'ramp', rampDirection: 'north' },
    };
    // A save/load cycle round-trips SemanticOverrides through
    // JSON.stringify/JSON.parse (see @threemaker/map-format's
    // serializeMapDocument/parseMapDocument) before the painter ever touches
    // it again -- this simulates that cycle at the store's own level, then
    // confirms a subsequent assignment to a DIFFERENT tile id still leaves
    // the ramp entry (class + override) fully intact.
    const roundTripped = JSON.parse(JSON.stringify(semantics)) as SemanticOverrides;
    const next = assignSemanticClass(roundTripped, new Set([9]), 'wall');

    expect(getSemanticClass(next, 5)).toBe('ramp');
    expect(next['5']?.rampDirection).toBe('north');
    expect(getSemanticClass(next, 9)).toBe('wall');
  });
});
