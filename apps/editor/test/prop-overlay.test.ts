import type { PropDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { computePropOverlayPoints } from '../src/prop-overlay.js';

const OBJECT = 'a'.repeat(64);

function prop(overrides: Partial<PropDocument> & Pick<PropDocument, 'id'>): PropDocument {
  return {
    x: 0,
    y: 0,
    floor: 'floor-0',
    object: OBJECT,
    ...overrides,
  };
}

describe('computePropOverlayPoints', () => {
  it('returns every prop on the given floor', () => {
    const props = [
      prop({ id: 'prop-1', x: 1, y: 2 }),
      prop({ id: 'prop-2', x: 3, y: 4, floor: 'floor-1' }),
      prop({ id: 'prop-3', x: 5, y: 6 }),
    ];
    expect(computePropOverlayPoints(props, 'floor-0')).toEqual([
      { id: 'prop-1', x: 1, y: 2 },
      { id: 'prop-3', x: 5, y: 6 },
    ]);
  });

  it('returns an empty list when no props sit on the floor', () => {
    expect(computePropOverlayPoints([prop({ id: 'prop-1' })], 'floor-1')).toEqual([]);
    expect(computePropOverlayPoints([], 'floor-0')).toEqual([]);
  });

  it('allows two props sharing a tile (schema deliberately permits it)', () => {
    const props = [prop({ id: 'table', x: 1, y: 1 }), prop({ id: 'lamp', x: 1, y: 1 })];
    expect(computePropOverlayPoints(props, 'floor-0')).toEqual([
      { id: 'table', x: 1, y: 1 },
      { id: 'lamp', x: 1, y: 1 },
    ]);
  });
});
