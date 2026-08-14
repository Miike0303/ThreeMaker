import type { LightDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { computeLightOverlayPoints } from '../src/light-overlay.js';

function placed(overrides: Partial<LightDocument> & Pick<LightDocument, 'id'>): LightDocument {
  return {
    kind: 'point',
    color: '#ffaa00',
    intensity: 1,
    range: 4,
    x: 0,
    y: 0,
    floor: 'floor-0',
    ...overrides,
  };
}

describe('computeLightOverlayPoints', () => {
  it('returns every placed light on the given floor with kind and color', () => {
    const lights = [
      placed({ id: 'light-1', x: 1, y: 2, kind: 'point', color: '#ffaa00' }),
      placed({ id: 'light-2', x: 3, y: 4, floor: 'floor-1' }),
      placed({ id: 'light-3', x: 5, y: 6, kind: 'spot', color: '#00ffaa' }),
      {
        id: 'torch',
        kind: 'point' as const,
        color: '#ff8800',
        intensity: 1,
        range: 3,
        attach: 'player',
      },
    ];
    expect(computeLightOverlayPoints(lights, 'floor-0')).toEqual([
      { id: 'light-1', x: 1, y: 2, kind: 'point', color: '#ffaa00' },
      { id: 'light-3', x: 5, y: 6, kind: 'spot', color: '#00ffaa' },
    ]);
  });

  it('returns empty when no placed lights sit on the floor', () => {
    expect(computeLightOverlayPoints([placed({ id: 'light-1' })], 'floor-1')).toEqual([]);
    expect(
      computeLightOverlayPoints(
        [
          {
            id: 'torch',
            kind: 'point',
            color: '#ff8800',
            intensity: 1,
            range: 3,
            attach: 'player',
          },
        ],
        'floor-0',
      ),
    ).toEqual([]);
  });

  it('allows multiple lights on the same tile (schema)', () => {
    const lights = [
      placed({ id: 'a', x: 1, y: 1 }),
      placed({ id: 'b', x: 1, y: 1, color: '#00ff00' }),
    ];
    expect(computeLightOverlayPoints(lights, 'floor-0')).toEqual([
      { id: 'a', x: 1, y: 1, kind: 'point', color: '#ffaa00' },
      { id: 'b', x: 1, y: 1, kind: 'point', color: '#00ff00' },
    ]);
  });
});
